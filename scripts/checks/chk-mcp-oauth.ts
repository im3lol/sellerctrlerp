/** Integration tests ONLY on the explicitly named disposable MCP clone. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.startsWith("/sellerctrl_mcp_test_")) throw new Error("Refusing to write test fixtures outside the isolated MCP database");
  const { db, pool } = await import("@/lib/db");
  const { users, organizations, organizationMembers, orgSubscriptions, items, itemCodes, warehouses, stockMovements } = await import("@/db/schema");
  const { mcpClients, mcpGrants, mcpCodes } = await import("@/db/mcp");
  const { withPlatformScope } = await import("@/lib/db-scope");
  const { withMcpUserScope } = await import("@/lib/mcp/scope");
  const { approveAuthorization, exchangeToken, authenticateMcp } = await import("@/lib/mcp/auth");
  const { listPersonalConnections, revokePersonalConnection, personalConnectionCompleted } = await import("@/lib/mcp/connections");
  const { opaque, digest, mcpUrls } = await import("@/lib/mcp/policy");
  const { signApiToken } = await import("@/lib/erp/api-auth");
  const errorOf = (result: Awaited<ReturnType<typeof exchangeToken>>) => "error" in result ? result.error : undefined;
  let checks = 0;
  const check = (ok: boolean, name: string) => { if (!ok) throw new Error(`FAIL ${name}`); checks++; console.log(`PASS ${name}`); };
  const actorA = randomUUID(), actorB = randomUUID(), suffix = opaque().slice(0, 10);
  try {
    const fixture = await withPlatformScope(async () => {
      const [org] = await db.insert(organizations).values({ nameAr: "MCP isolated test", nameEn: "MCP isolated test", slug: `mcp-test-${suffix}` }).returning();
      for (const [id, n] of [[actorA, "a"], [actorB, "b"]]) {
        await db.insert(users).values({ id, username: `mcp_${n}_${suffix}`, email: `mcp-${n}-${suffix}@example.invalid`, name: `MCP ${n}`, passwordHash: "disabled-test-password-no-login", role: "employee", isActive: true });
        await db.insert(organizationMembers).values({ organizationId: org.id, userId: id, role: "inventory" });
      }
      await db.insert(orgSubscriptions).values({ organizationId: org.id, status: "ACTIVE", planName: "MCP test", enabledModules: ["inventory", "purchases"], expiresAt: new Date(Date.now() + 86400_000) });
      const [client] = await db.insert(mcpClients).values({ name: "MCP integration test", redirectUris: ["https://client.example/callback"] }).returning();
      const [warehouse] = await db.insert(warehouses).values({ organizationId: org.id, code: "MCP", nameAr: "MCP warehouse", nameEn: "MCP warehouse" }).returning();
      const [item] = await db.insert(items).values({ organizationId: org.id, code: "MCP-TEST", nameAr: "MCP isolated item" }).returning();
      const asin = `B0${suffix.toUpperCase()}`;
      await db.insert(itemCodes).values({ organizationId: org.id, itemId: item.id, codeType: "ASIN", code: asin });
      await db.insert(stockMovements).values({ organizationId: org.id, number: "MIG-LCV-ab12", itemId: item.id, warehouseId: warehouse.id,
        type: "IN", quantity: "3", unitCost: "5", totalCost: "15", balanceQuantity: "3", balanceValue: "15", date: new Date() });
      return { org, client, item, warehouse, asin };
    });
    const grant = async (actor = actorA) => {
      const verifier = opaque();
      const input = { client_id: fixture.client.id, redirect_uri: "https://client.example/callback", response_type: "code", code_challenge: digest(verifier), code_challenge_method: "S256", scope: "erp.identity inventory.read", state: opaque(), resource: mcpUrls().resource };
      const redirect = new URL(await approveAuthorization(actor, fixture.org.id, input));
      const code = redirect.searchParams.get("code")!;
      return { verifier, input, code, exchange: { grant_type: "authorization_code", client_id: input.client_id, redirect_uri: input.redirect_uri, code, code_verifier: verifier, resource: input.resource } };
    };
    const first = await grant();
    const waitingConnections = await listPersonalConnections(fixture.org.id, actorA);
    check(waitingConnections.length === 1 && !waitingConnections[0].isAuthorized, "personal settings distinguish an unfinished OAuth request from authorization");
    check(!await personalConnectionCompleted(fixture.org.id, actorA, first.code), "consent does not claim success before the client exchanges its code");
    check(errorOf(await exchangeToken({ ...first.exchange, client_id: randomUUID() })) === "invalid_grant", "authorization code is bound to its registered client");
    check(errorOf(await exchangeToken({ ...first.exchange, code_verifier: opaque() })) === "invalid_grant", "wrong PKCE cannot redeem or consume a code");
    const tokens = await exchangeToken(first.exchange);
    if (!("access_token" in tokens)) throw new Error("Token exchange failed");
    check((await listPersonalConnections(fixture.org.id, actorA))[0]?.isAuthorized === true, "personal settings mark authorization only after code exchange");
    check(await personalConnectionCompleted(fixture.org.id, actorA, first.code), "consenting person sees completion after the client exchanges its code");
    check(!await personalConnectionCompleted(fixture.org.id, actorB, first.code), "another same-company user cannot observe connection completion");
    const principal = await authenticateMcp(tokens.access_token!);
    check(principal?.userId === actorA && principal.orgId === fixture.org.id, "access token binds user and company");
    check(principal?.permissions.has("inventory.view") === true && !principal.permissions.has("inventory.confirm"), "read grant never receives write permissions");
    const { currentStock } = await import("@/lib/erp/inventory");
    const engineStock = await withMcpUserScope(fixture.org.id, actorA, () => currentStock(fixture.org.id, fixture.item.id, fixture.warehouse.id));
    check(engineStock.quantity === 3 && engineStock.avgCost === 5, "inventory engine also reads imported movement numbers safely");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { POST } = await import("@/app/mcp/route");
    const { forwardMcpTestRequest } = await import("./mcp-test-transport");
    const client = new Client({ name: "MCP isolation test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrls().resource), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      fetch: async (input, init) => { const req = new Request(input, init); return await forwardMcpTestRequest(req) ?? POST(req); },
    });
    try {
      await client.connect(transport);
      const toolNames = (await client.listTools()).tools.map(t => t.name);
      check(toolNames.includes("search_items") && !toolNames.includes("get_financial_report"), "official MCP SDK lists only the user's delegated tools");
      const result = await client.callTool({ name: "search_items", arguments: { query: "", organization_id: "forged-company" } });
      const content = result.content as { type: string; text?: string }[];
      const body = JSON.parse(content.find(c => c.type === "text")!.text!);
      check(body.companyId === fixture.org.id && body.data.items.length === 1 && body.data.items[0].id === fixture.item.id, "MCP tool cannot select another company through its arguments");
      const aliasResult = await client.callTool({ name: "search_items", arguments: { query: fixture.asin } });
      const aliasContent = aliasResult.content as { type: string; text?: string }[];
      const aliasBody = JSON.parse(aliasContent.find(c => c.type === "text")!.text!);
      check(aliasBody.data.items.length === 1 && aliasBody.data.items[0].codes.some((c: { code: string }) => c.code === fixture.asin), "MCP resolves ASIN aliases inside the authorized company");
      const stock = await client.callTool({ name: "get_stock", arguments: { item_id: fixture.item.id } });
      const stockContent = stock.content as { type: string; text?: string }[];
      const stockBody = JSON.parse(stockContent.find(c => c.type === "text")!.text!);
      check(stockBody.data.balances[0].quantity === 3 && stockBody.data.balances[0].value === null, "MCP stock handles imported movement numbers without exposing cost");
    } finally { await client.close(); }
    check(errorOf(await exchangeToken({ ...first.exchange, resource: "https://other.example/mcp" })) === "invalid_target", "resource audience cannot change");
    check(await authenticateMcp(await signApiToken(actorA, 0)) === null, "normal API token is not an MCP token");
    await grant(actorB);
    check((await listPersonalConnections(fixture.org.id, actorA)).every(r => r.id === principal!.grant.id), "same-company user sees only their connection");
    check(!await revokePersonalConnection(fixture.org.id, actorB, principal!.grant.id), "user cannot revoke another user's connection");
    await withMcpUserScope(fixture.org.id, actorA, async () => {
      await db.execute(sql`set local role appuser`);
      const rows = await db.select().from(mcpGrants);
      check(rows.length === 1 && rows[0].userId === actorA, "database RLS isolates users even without an application WHERE clause");
      const codes = await db.select().from(mcpCodes);
      check(codes.every(c => c.grantId === principal!.grant.id), "authorization codes inherit personal RLS");
    });
    let crossUserWriteDenied = false;
    try {
      await withMcpUserScope(fixture.org.id, actorA, async () => {
        await db.execute(sql`set local role appuser`);
        await db.insert(mcpGrants).values({ organizationId: fixture.org.id, userId: actorB, clientId: fixture.client.id,
          scopes: ["erp.identity"], sessionVersion: 0, expiresAt: new Date(Date.now() + 86400_000) });
      });
    } catch (error) { crossUserWriteDenied = (error as { cause?: { code?: string } }).cause?.code === "42501"; }
    check(crossUserWriteDenied, "personal RLS rejects writing another user's grant in the same company");
    const refreshed = await exchangeToken({ grant_type: "refresh_token", client_id: fixture.client.id, refresh_token: tokens.refresh_token! });
    check("access_token" in refreshed && !!refreshed.access_token, "refresh rotates token");
    check(errorOf(await exchangeToken({ grant_type: "refresh_token", client_id: fixture.client.id, refresh_token: tokens.refresh_token! })) === "invalid_grant", "refresh replay is rejected");
    check("access_token" in refreshed && await authenticateMcp(refreshed.access_token!) === null, "refresh replay revokes the whole grant");
    const second = await grant(); const secondTokens = await exchangeToken(second.exchange);
    if (!("access_token" in secondTokens)) throw new Error("Second exchange failed");
    await withPlatformScope(() => db.update(users).set({ sessionVersion: 1 }).where(eq(users.id, actorA)));
    check(await authenticateMcp(secondTokens.access_token!) === null, "logout-all revokes active MCP access");
    check(errorOf(await exchangeToken({ grant_type: "refresh_token", client_id: fixture.client.id, refresh_token: secondTokens.refresh_token! })) === "invalid_grant", "logout-all also blocks refresh");
    const third = await grant(); const thirdTokens = await exchangeToken(third.exchange);
    if (!("access_token" in thirdTokens)) throw new Error("Third exchange failed");
    await exchangeToken(third.exchange);
    check(await authenticateMcp(thirdTokens.access_token!) === null, "authorization-code replay revokes its grant");
    const fourth = await grant(); const fourthTokens = await exchangeToken(fourth.exchange);
    if (!("access_token" in fourthTokens)) throw new Error("Fourth exchange failed");
    await withPlatformScope(() => db.update(organizationMembers).set({ permissionOverrides: { grant: [], revoke: ["inventory.view"] } })
      .where(and(eq(organizationMembers.organizationId, fixture.org.id), eq(organizationMembers.userId, actorA))));
    check(!(await authenticateMcp(fourthTokens.access_token!))?.scopes.has("inventory.read"), "permission revocation immediately removes the MCP scope");
    await withPlatformScope(() => db.update(organizationMembers).set({ permissionOverrides: null })
      .where(and(eq(organizationMembers.organizationId, fixture.org.id), eq(organizationMembers.userId, actorA))));
    await withPlatformScope(() => db.update(orgSubscriptions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orgSubscriptions.organizationId, fixture.org.id)));
    check(!(await authenticateMcp(fourthTokens.access_token!))?.scopes.has("inventory.read"), "subscription expiry immediately removes paid read scopes");
    await withPlatformScope(() => db.update(orgSubscriptions).set({ expiresAt: new Date(Date.now() + 86400_000) }).where(eq(orgSubscriptions.organizationId, fixture.org.id)));
    await withPlatformScope(() => db.update(organizationMembers).set({ isActive: false })
      .where(and(eq(organizationMembers.organizationId, fixture.org.id), eq(organizationMembers.userId, actorA))));
    check(await authenticateMcp(fourthTokens.access_token!) === null, "disabled membership blocks MCP access");
    await withPlatformScope(() => db.update(organizationMembers).set({ isActive: true })
      .where(and(eq(organizationMembers.organizationId, fixture.org.id), eq(organizationMembers.userId, actorA))));
    const { verifySdkOAuthFlow } = await import("./mcp-sdk-oauth-flow");
    await verifySdkOAuthFlow(actorA, fixture.org.id, check);
    console.log(`MCP integration: ${checks} checks passed; production was not modified.`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
