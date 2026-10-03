import { listApprovals } from "@/lib/erp/approvals";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scope = "pending" | "mine" | "done";
const scopes: Scope[] = ["pending", "mine", "done"];

/** The mobile approval inbox. It contains only approval rows; document posting still
 * follows its own endpoint and workflow after the decision. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "settings.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const value = new URL(req.url).searchParams.get("scope");
  const scope: Scope = scopes.includes(value as Scope) ? value as Scope : (auth.can("approvals.decide") ? "pending" : "mine");

  return runAsErp(auth, async () => {
    const rows = scope === "pending"
      ? (auth.can("approvals.decide") ? await listApprovals(auth.orgId, { status: "PENDING" }) : [])
      : scope === "mine"
        ? await listApprovals(auth.orgId, { requestedBy: auth.userId, limit: 100 })
        : (auth.can("approvals.decide") ? (await listApprovals(auth.orgId, { limit: 150 })).filter((row) => row.status === "APPROVED" || row.status === "REJECTED") : []);
    return Response.json({ data: {
      canDecide: auth.can("approvals.decide"),
      rows: rows.map((row) => ({
        ...row,
        requestedAt: row.requestedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
      })),
    } });
  });
}
