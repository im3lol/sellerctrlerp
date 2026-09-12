"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importStatementAction, toggleStatementLineReconciledAction, type ImportPreview } from "@/app/actions/erp/bank-accounts";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v: number) => v.toLocaleString("ar-EG-u-nu-latn");

/** Upload the bank's own statement file — see what was read, then save it. */
export function BankImport({ bankAccountId }: { bankAccountId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();

  const run = (commit: boolean) => start(async () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    const r = await importStatementAction(bankAccountId, fd, commit);
    if (r.error) { toast.error(r.error); return; }
    if (!commit) { setPreview(r); return; }
    toast.success(`اتضاف ${n(r.added ?? 0)} حركة${r.duplicates ? ` · ${n(r.duplicates)} كانت متسجلة قبل كده` : ""}`);
    setPreview(null);
    setFile(null);
    router.refresh();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>استيراد كشف الحساب</CardTitle>
        <CardDescription>
          ارفع ملف الكشف زي ما البنك بيطلّعه (Excel أو CSV). بنعرف الأعمدة من عناوينها، وبتشوف اللي اتقرا قبل ما يتحفظ،
          والحركة اللي اتسجلت قبل كده مابتتكررش.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="file" accept=".csv,.xlsx,.xls" className="max-w-sm"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
          <Button variant="outline" disabled={!file || pending} onClick={() => run(false)}>
            {pending && !preview && <Loader2 className="size-4 animate-spin" />}معاينة
          </Button>
        </div>

        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{preview.columns}</p>
            {preview.sample && preview.sample.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">التاريخ</th>
                      <th className="px-3 py-2 text-start font-medium">البيان</th>
                      <th className="px-3 py-2 text-start font-medium">وارد</th>
                      <th className="px-3 py-2 text-start font-medium">صادر</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.sample.map((l, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{l.date}</td>
                        <td className="px-3 py-2">{l.description || "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{l.moneyIn ? fmt(l.moneyIn) : ""}</td>
                        <td className="px-3 py-2 tabular-nums text-red-600 dark:text-red-400">{l.moneyOut ? fmt(l.moneyOut) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{n(preview.total ?? 0)} حركة جديدة</span>
              {!!preview.duplicates && <span className="text-muted-foreground">· {n(preview.duplicates)} متسجلة قبل كده</span>}
              {!!preview.skipped && <span className="text-muted-foreground">· {n(preview.skipped)} سطر مش حركة (رصيد أو إجمالي)</span>}
              <Button className="ms-auto" disabled={pending || !preview.total} onClick={() => run(true)}>
                {pending && <Loader2 className="size-4 animate-spin" />}استورد {n(preview.total ?? 0)} حركة
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Confirm the suggested deposit as the one that carried this payout. */
export function MatchButton({ lineId }: { lineId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending}
      onClick={() => start(async () => {
        const r = await toggleStatementLineReconciledAction(lineId);
        if (r.error) toast.error(r.error); else router.refresh();
      })}>
      {pending && <Loader2 className="size-4 animate-spin" />}طابق
    </Button>
  );
}
