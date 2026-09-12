import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { requireUser } from "@/lib/session";
import { listApprovals, approvalEntityHref, APPROVAL_DOC_LABEL, type ApprovalRow } from "@/lib/erp/approvals";
import { timeAgo, type ApprovalDocType } from "@/lib/erp/approval-policy";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApprovalDecision } from "@/components/erp/approval-banner";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "مستني", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  APPROVED: { label: "معتمد", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  REJECTED: { label: "مرفوض", cls: "bg-destructive/10 text-destructive" },
  CANCELLED: { label: "اتلغى", cls: "bg-muted text-muted-foreground" },
};

type Tab = "pending" | "mine" | "done";

/**
 * «الموافقات» — every document held for a manager, in one place.
 *
 * An approver lands on what's waiting for them, oldest first; anyone else lands on the
 * requests they filed, so a buyer can see their order is waiting rather than wondering.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return loadErpPage("settings.view", async ({ orgId, role, can }) => {
    const user = await requireUser();
    const canDecide = can("approvals.decide");
    const isAdmin = role === "admin" || role === "super_admin";
    const sp = await searchParams;
    const tab: Tab = sp.tab === "mine" || sp.tab === "done" ? sp.tab : canDecide ? "pending" : "mine";

    const rows: ApprovalRow[] =
      tab === "pending" ? await listApprovals(orgId, { status: "PENDING" })
      : tab === "mine" ? await listApprovals(orgId, { requestedBy: user.id, limit: 100 })
      : (await listApprovals(orgId, { limit: 150 })).filter((r) => r.status === "APPROVED" || r.status === "REJECTED");

    const tabs: { key: Tab; label: string; show: boolean }[] = [
      { key: "pending", label: "مستني موافقتك", show: canDecide },
      { key: "mine", label: "طلباتي", show: true },
      { key: "done", label: "اتقرر فيها", show: canDecide },
    ];

    const empty: Record<Tab, string> = {
      pending: "مفيش حاجة مستنية موافقتك ✓",
      mine: "مابعتّش أي مستند للاعتماد.",
      done: "لسه مفيش قرارات.",
    };

    return (
      <div className="space-y-5">
        <ErpPageHeader icon="ClipboardCheck" title="الموافقات" subtitle="المستندات اللي عدّت حد الاعتماد ومستنية قرار مدير" />

        <div className="flex flex-wrap gap-2">
          {tabs.filter((t) => t.show).map((t) => (
            <Link key={t.key} href={`/approvals?tab=${t.key}`}
              className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors",
                tab === t.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
              {t.label}
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">{empty[tab]}</div>
            ) : (
              <div className="divide-y">
                {rows.map((r) => {
                  const st = STATUS[r.status] ?? STATUS.CANCELLED;
                  const mine = r.requestedBy === user.id;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{APPROVAL_DOC_LABEL[r.entityType as ApprovalDocType] ?? r.entityType}</Badge>
                          <Link href={approvalEntityHref(r.entityType, r.entityNumber, r.entityId)} className="font-mono text-sm font-medium hover:text-primary hover:underline">
                            {r.entityNumber ?? "—"}
                          </Link>
                          {r.amount != null && <span className="text-sm tabular-nums text-muted-foreground">{fmt(r.amount)}</span>}
                          <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                        </div>
                        <div className="text-sm">{r.reason}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.requestedByName ? `طلبه ${r.requestedByName}` : "اعتماد مباشر"} · {timeAgo(r.requestedAt)}
                          {r.decidedByName ? ` · قرّره ${r.decidedByName}${r.decidedAt ? ` ${timeAgo(r.decidedAt)}` : ""}` : ""}
                        </div>
                        {r.comment && <div className="text-xs">{r.status === "REJECTED" ? `سبب الرفض: ${r.comment}` : r.comment}</div>}
                      </div>
                      {tab === "pending" && r.status === "PENDING" && (
                        canDecide && (!mine || isAdmin)
                          ? <ApprovalDecision requestId={r.id} compact />
                          : <span className="text-xs text-muted-foreground">طلبك — مستني مدير تاني</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
