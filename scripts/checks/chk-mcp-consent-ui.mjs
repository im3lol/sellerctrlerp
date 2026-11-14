// Real browser QA, fixtures and OAuth codes only in the isolated MCP database.
import pg from "pg";
import { encode } from "next-auth/jwt";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const dbUrl = new URL(process.env.DATABASE_URL);
if (!dbUrl.pathname.startsWith("/sellerctrl_mcp_test_")) throw new Error("UI fixtures require isolated MCP database");
const origin = "http://127.0.0.1:3012";
const runtime = process.env.MCP_QA_PACKAGES;
if (!runtime) throw new Error("MCP_QA_PACKAGES must point to the bundled Node packages");
const { chromium } = createRequire(join(runtime, "package.json"))("playwright");
const pool = new pg.Pool({ connectionString: dbUrl.href });
let browser;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL ${label}`); console.log(`PASS ${label}`); };
try {
  const { rows: [user] } = await pool.query("select u.id,u.role,u.name,u.session_version,m.organization_id from users u join organization_members m on m.user_id=u.id join organizations o on o.id=m.organization_id where u.username like 'mcp_b_%' and u.is_active=true and m.is_active=true and o.slug like 'mcp-test-%' order by u.created_at desc limit 1");
  if (!user) throw new Error("Run MCP integration fixtures first");
  await pool.query("update org_subscriptions set status='ACTIVE',expires_at=now()+interval '1 day' where organization_id=$1", [user.organization_id]);
  const clientId = randomUUID();
  await pool.query("insert into mcp_clients(id,name,redirect_uris) values($1,$2,$3::jsonb)", [clientId, "Codex · UI preview", JSON.stringify(["http://127.0.0.1:43189/callback"])]);
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: "http://127.0.0.1:43189/callback", response_type: "code", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource: `${process.env.APP_URL}/mcp`, scope: "erp.identity inventory.read purchases.read sales.read accounting.read marketplace.read", state: "ui-preview" });
  const cookieName = "authjs.session-token";
  const token = await encode({ secret: process.env.AUTH_SECRET, salt: cookieName, maxAge: 600, token: { sub: user.id, id: user.id, role: user.role, name: user.name, sv: user.session_version } });
  const out = join(process.cwd(), ".next", "mcp-ui-preview");
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, colorScheme: "light" });
  await context.addCookies([{ name: cookieName, value: token, url: origin, httpOnly: true }, { name: "locale", value: "ar", url: origin }, { name: "erp_org", value: user.organization_id, url: origin }]);
  const page = await context.newPage();
  await page.goto(`${origin}/mcp/authorize?${params}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "ربط تطبيق بحسابك" }).waitFor();
  check(await page.locator("aside").count() === 0, "consent is independent of the ERP sidebar");
  check(await page.getByRole("checkbox").count() === 6, "all requested read scopes are shown");
  await page.screenshot({ path: join(out, "consent-ar-desktop.png"), fullPage: true });
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.locator("..").click();
  check(await page.getByRole("button", { name: "موافقة وربط" }).isDisabled(), "empty permission selection cannot be approved");
  await page.getByRole("checkbox").nth(1).locator("..").click();
  check(await page.getByRole("button", { name: "موافقة وربط" }).isEnabled(), "one chosen read scope enables approval");
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile consent has no horizontal overflow");
  await page.screenshot({ path: join(out, "consent-ar-mobile.png"), fullPage: true });
  await context.addCookies([{ name: "locale", value: "en", url: origin }]);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Connect an app to your account" }).waitFor();
  check(await page.locator("html").getAttribute("dir") === "ltr", "English consent uses LTR and translated labels");
  await page.screenshot({ path: join(out, "consent-en-mobile.png"), fullPage: true });
  // A forged company is rejected inline, without crashing the consent page.
  await page.locator("#mcp-company").evaluate(select => { const option = document.createElement("option"); option.value = "00000000-0000-4000-8000-000000000001"; select.add(option); select.value = option.value; });
  await page.getByRole("button", { name: "Allow connection" }).click();
  await page.getByRole("alert").filter({ hasText: "Could not complete the connection" }).waitFor();
  check(await page.getByRole("heading", { name: "Connect an app to your account" }).isVisible(), "invalid company stays on the form with an inline error");
  for (const other of context.pages().filter(p => p !== page)) {
    if (!other.isClosed()) await other.waitForEvent("close");
  }
  await page.locator("#mcp-company").selectOption(user.organization_id);
  await context.route("http://127.0.0.1:43189/**", async route => {
    const code = new URL(route.request().url()).searchParams.get("code");
    const response = await fetch(`${origin}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: "http://127.0.0.1:43189/callback", resource: `${process.env.APP_URL}/mcp` }) });
    check(response.ok, "test client exchanges its code through the real token endpoint");
    await response.body?.cancel();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Test callback received</p>" });
  });
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Allow connection" }).click();
  const popup = await popupPromise;
  await page.getByRole("heading", { name: "Connected successfully" }).waitFor();
  await page.screenshot({ path: join(out, "connected-en-mobile.png"), fullPage: true });
  if (!popup.isClosed()) {
    check(await popup.evaluate(() => window.opener === null), "callback popup cannot access its originating ERP page");
    await popup.close();
  }
  check(await page.getByRole("heading", { name: "Connected successfully" }).isVisible(), "branded success follows a confirmed code exchange");
  check(new URL(page.url()).origin === origin, "branded success stays on SellerCtrl");
  await page.screenshot({ path: join(out, "connected-en-mobile.png"), fullPage: true });
  await page.goto(`${origin}/mcp/authorize?${params}`, { waitUntil: "networkidle" });
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("button", { name: "Allow connection" }).click();
  await page.waitForURL("http://127.0.0.1:43189/**");
  check(!!new URL(page.url()).searchParams.get("code"), "blocked popup safely falls back to the registered callback");
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  await noJs.addCookies([{ name: cookieName, value: token, url: origin, httpOnly: true }, { name: "locale", value: "en", url: origin }, { name: "erp_org", value: user.organization_id, url: origin }]);
  await noJs.route("http://127.0.0.1:43189/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<p>Native form callback received</p>" }));
  const nativeForm = await noJs.newPage();
  await nativeForm.goto(`${origin}/mcp/authorize?${params}`);
  const nativeResponse = nativeForm.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/mcp/authorize");
  await nativeForm.getByRole("button", { name: "Allow connection" }).click();
  const nativeResult = await nativeResponse;
  const nativeTarget = new URL(await nativeResult.headerValue("location"), origin);
  check(nativeResult.status() === 303 && nativeTarget.origin === "http://127.0.0.1:43189" && !!nativeTarget.searchParams.get("code"), "native consent without JavaScript redirects to the registered callback");
  await noJs.close();
  // Web OAuth callbacks must return to the original tab, with its per-tab state.
  const webClientId = randomUUID();
  const webCallback = "https://client.example/callback";
  await pool.query("insert into mcp_clients(id,name,redirect_uris) values($1,$2,$3::jsonb)", [webClientId, "Web OAuth context fixture", JSON.stringify([webCallback])]);
  const webParams = new URLSearchParams(params);
  webParams.set("client_id", webClientId);
  webParams.set("redirect_uri", webCallback);
  const webPage = await context.newPage();
  await context.route("https://client.example/**", async route => {
    if (new URL(route.request().url()).pathname === "/start") return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Client start</h1>" });
    const callback = new URL(route.request().url());
    const response = await fetch(`${origin}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: webClientId, code: callback.searchParams.get("code"), code_verifier: verifier, redirect_uri: webCallback, resource: `${process.env.APP_URL}/mcp` }) });
    check(response.ok, "web callback exchanges the code through the real token endpoint");
    await response.body?.cancel();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Web callback</h1><p id='context'></p><script>document.getElementById('context').textContent=sessionStorage.getItem('oauth-context')||'missing'</script>" });
  });
  await webPage.goto("https://client.example/start");
  await webPage.evaluate(() => sessionStorage.setItem("oauth-context", "original-tab-state"));
  let extraWindows = 0;
  webPage.on("popup", () => extraWindows++);
  await webPage.goto(`${origin}/mcp/authorize?${webParams}`, { waitUntil: "networkidle" });
  // The server also ignores a forged popup handoff flag for web callbacks.
  await webPage.locator('input[name="popup_handoff"]').evaluate(el => { el.value = "1"; });
  await webPage.getByRole("button", { name: "Allow connection" }).click();
  await webPage.waitForURL("https://client.example/callback?**");
  check(extraWindows === 0, "web consent does not create a second OAuth window");
  check(await webPage.locator("#context").textContent() === "original-tab-state", "web callback keeps the client's original sessionStorage");
  check(new URL(webPage.url()).searchParams.get("state") === "ui-preview", "web callback returns the original OAuth state");
  await webPage.close();
  if (process.env.MCP_QA_SETTINGS === "1") {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${origin}/settings/mcp`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Connect your app yourself" }).waitFor();
    const apps = ["ChatGPT", "Claude", "Codex", "Claude Code", "Gemini CLI", "Cursor", "VS Code / Copilot"];
    for (const app of apps) {
      await page.getByRole("button", { name: app, exact: true }).click();
      check(await page.getByRole("region", { name: app, exact: true }).isVisible(), `${app} has its own setup guide`);
    }
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy server URL", exact: true }).click();
    check(await page.evaluate(() => navigator.clipboard.readText()) === `${process.env.APP_URL}/mcp`, "copying uses the canonical server URL");
    for (const app of ["Cursor", "VS Code / Copilot"]) {
      await page.getByRole("button", { name: app, exact: true }).click();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download configuration" }).click();
      const download = await downloadPromise;
      const stream = await download.createReadStream(); const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      check((json.mcpServers ?? json.servers)?.sellerctrl?.url === `${process.env.APP_URL}/mcp`, `${app} downloads a usable client-specific config`);
    }
    await page.screenshot({ path: join(out, "setup-en-desktop.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "setup wizard has no mobile horizontal overflow");
    await page.locator('[aria-labelledby="setup-title"]').screenshot({ path: join(out, "setup-en-mobile.png") });
    await context.addCookies([{ name: "locale", value: "ar", url: origin }]);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "اربط تطبيقك بنفسك" }).waitFor();
    check(await page.locator("html").getAttribute("dir") === "rtl", "setup wizard supports Arabic RTL");
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: join(out, "setup-ar-desktop.png"), fullPage: false });
  }
  console.log(`Screenshots saved under ${out}; production was not modified.`);
} finally {
  await browser?.close();
  await pool.end();
}
