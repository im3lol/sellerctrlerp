"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";
import { decideApprovalAction } from "@/app/actions/erp/approvals";
import { timeAgo as ago } from "@/lib/erp/approval-policy";
import { cn } from "@/lib/utils";

export type BannerApproval = {
  id: string; status: string; reason: string; comment: string | null;
  requestedBy: string | null; requestedByName: string | null; requestedAt: string | Date;
  decidedByName: string | null; decidedAt: string | Date | null;
};


/** Approve / reject, with the reason a rejection needs asked for inline — no dialog. */
export function ApprovalDecision({ requestId, compact }: { requestId: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");

  const decide = (decision: "APPROVE" | "REJECT") => start(async () => {
    const r = await decideApprovalAction(requestId, decision, comment);
    if (r.ok) { toast.success(decision === "APPROVE" ? "تم الاعتماد" : "تم الرفض"); setRejecting(false); router.refresh(); }
    else toast.error(r.error ?? "تعذّر التنفيذ");
  });

  if (rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder="سبب الرفض — اللي طلب هيشوفه" className="h-8 min-w-56 flex-1 text-sm" />
        <Button size="sm" variant="destructive" disabled={pending || !comment.trim()} onClick={() => decide("REJECT")}>
          {pending && <Loader2 className="size-4 animate-spin" />}رفض
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>رجوع</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button size={compact ? "sm" : "default"} disabled={pending} onClick={() => decide("APPROVE")}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}اعتماد
      </Button>
      <Button size={compact ? "sm" : "default"} variant="outline" disabled={pending} onClick={() => setRejecting(true)}>رفض</Button>
    </div>
  );
}

/**
 * The approval state of one document, shown at the top of its page. Nothing when the
 * document never needed approval; the decision buttons only for someone who may decide
 * — and not for the person who asked, unless they are the admin.
 */
export function ApprovalBanner({ approval, canDecide, currentUserId, isAdmin }: {
  approval: BannerApproval | null; canDecide: boolean; currentUserId: string; isAdmin: boolean;
}) {
  if (!approval || approval.status === "CANCELLED") return null;
  const mine = approval.requestedBy === currentUserId;

  if (approval.status === "PENDING") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <Icon name="Clock" className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold">مستني اعتماد المدير</div>
            <div>{approval.reason}</div>
            <div className="text-xs opacity-80">
              {approval.requestedByName ? `طلبه ${approval.requestedByName} · ` : ""}{ago(approval.requestedAt)}
            </div>
          </div>
        </div>
        {canDecide && (!mine || isAdmin) && <ApprovalDecision requestId={approval.id} />}
      </div>
    );
  }

  const approved = approval.status === "APPROVED";
  return (
    <div className={cn(
      "flex items-start gap-2 rounded-xl border p-4 text-sm",
      approved
        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
        : "border-destructive/40 bg-destructive/5 text-destructive",
    )}>
      <Icon name={approved ? "CheckCircle2" : "XCircle"} className="mt-0.5 size-4 shrink-0" />
      <div>
        <div className="font-semibold">
          {approved ? "معتمد" : "مرفوض"}
          {approval.decidedByName ? ` — ${approval.decidedByName}` : ""}
          {approval.decidedAt ? ` · ${ago(approval.decidedAt)}` : ""}
        </div>
        <div className="opacity-90">{approval.reason}</div>
        {approval.comment && <div className="mt-1">{approved ? approval.comment : `السبب: ${approval.comment}`}</div>}
        {!approved && <div className="mt-1 text-xs opacity-80">عدّل المستند وأكّده تاني — هيتبعت للمدير من جديد.</div>}
      </div>
    </div>
  );
}
