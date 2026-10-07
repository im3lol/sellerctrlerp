import { decideApproval } from "@/lib/erp/approvals";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "approvals.decide");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  if (body?.decision !== "APPROVE" && body?.decision !== "REJECT") return Response.json({ error: "invalid_decision" }, { status: 400 });
  const { id } = await params;
  return runAsErp(auth, async () => {
    const result = await decideApproval({
      orgId: auth.orgId, userId: auth.userId, role: auth.role, requestId: id,
      decision: body.decision, comment: typeof body.comment === "string" ? body.comment : undefined,
    });
    // decideApproval returns {ok} or {error} — narrow on the error side, there is no
    // `ok` property to read on the failure branch.
    return Response.json(result, { status: "error" in result ? 400 : 200 });
  });
}
