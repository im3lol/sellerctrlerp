"use client";

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const fmt = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One labelled amount in the breakdown. Module scope, so it isn't rebuilt every render. */
function Line({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-6 ${muted ? "opacity-70" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{fmt(value)}</span>
    </div>
  );
}

type Props = {
  commission: number; commissionTax: number;
  fbaFee: number; fbaFeeTax: number;
  otherFees: number;
};

/**
 * Everything the marketplace charged on a row, as one number.
 *
 * Three fee columns plus their tax halves is six figures per row on a table that already
 * has eleven columns — accurate and unreadable. The column carries the total, which is
 * what anyone actually compares against a payout, and the tooltip carries the split the
 * way Seller Central prints it: each fee, its base and its tax.
 */
export function FeeCell({ commission, commissionTax, fbaFee, fbaFeeTax, otherFees }: Props) {
  const total = Math.round((commission + fbaFee + otherFees) * 100) / 100;
  if (!total) return <span className="text-muted-foreground">—</span>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help tabular-nums text-amber-600 underline decoration-dotted underline-offset-4">
          {fmt(total)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="px-3 py-2">
        <div className="space-y-1.5 text-xs">
          {commission !== 0 && (
            <div className="space-y-0.5">
              <Line label="عمولة البيع" value={commission} />
              {commissionTax !== 0 && (
                <div className="ps-3 text-[11px] leading-tight">
                  <Line label="الأساسي" value={commission - commissionTax} muted />
                  <Line label="الضريبة" value={commissionTax} muted />
                </div>
              )}
            </div>
          )}
          {fbaFee !== 0 && (
            <div className="space-y-0.5">
              <Line label="رسوم FBA" value={fbaFee} />
              {fbaFeeTax !== 0 && (
                <div className="ps-3 text-[11px] leading-tight">
                  <Line label="الأساسي" value={fbaFee - fbaFeeTax} muted />
                  <Line label="الضريبة" value={fbaFeeTax} muted />
                </div>
              )}
            </div>
          )}
          {otherFees !== 0 && <Line label="رسوم أخرى" value={otherFees} />}
          <div className="border-t border-background/25 pt-1 font-medium">
            <Line label="الإجمالي" value={total} />
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
