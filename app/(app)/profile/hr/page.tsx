import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { getMyHrAction } from "@/app/actions/erp/my-hr";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LEAVE_LABEL: Record<string, string> = {
  ANNUAL: "سنوية", SICK: "مرضية", UNPAID: "بدون أجر", OTHER: "أخرى",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "قيد المراجعة", APPROVED: "معتمدة", REJECTED: "مرفوضة", POSTED: "مُرحّل", REVERSED: "معكوس",
};
const statusTone = (s: string) =>
  s === "APPROVED" || s === "POSTED" ? "secondary" : s === "REJECTED" ? "destructive" : "outline";

/**
 * The employee's own corner of HR. No hr.* permission is required — the page only ever
 * shows the record belonging to the signed-in user, so needing HR rights to read your
 * own payslip would mean handing everyone the right to read everyone else's.
 */
export default async function MyHrPage() {
  const t = await getT();
  const d = await getMyHrAction();

  if (!d.employee) {
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="IdCard" title={t("ملفي الوظيفي")} subtitle={t("راتبي وإجازاتي وطلباتي")} backHref="/profile" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t("حسابك مش مربوط بملف موظف. اطلب من الموارد البشرية يربطوا حسابك بملفك عشان تشوف راتبك وإجازاتك هنا.")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const lastNet = d.payslips[0]?.net ?? 0;
  const openLeaves = d.leaves.filter((l) => l.status === "DRAFT").length;
  const openClaims = d.claims.filter((c) => c.status === "DRAFT").length;

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="IdCard"
        title={t("ملفي الوظيفي")}
        subtitle={[d.employee.position, d.employee.department].filter(Boolean).join(" · ") || t("راتبي وإجازاتي وطلباتي")}
        backHref="/profile"
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">{t("آخر صافي راتب")}</div>
          <div className="text-2xl font-bold tabular-nums">{money(lastNet)}</div>
          <div className="text-xs text-muted-foreground">{d.payslips[0]?.period ?? "—"}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">{t("قسائم الراتب")}</div>
          <div className="text-2xl font-bold tabular-nums">{d.payslips.length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">{t("إجازات قيد المراجعة")}</div>
          <div className="text-2xl font-bold tabular-nums">{openLeaves}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">{t("مطالبات قيد المراجعة")}</div>
          <div className="text-2xl font-bold tabular-nums">{openClaims}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("قسائم الراتب")}</CardTitle>
          <CardDescription>{t("آخر ٢٤ شهر. القسيمة المُرحّلة تقدر تطبعها.")}</CardDescription>
        </CardHeader>
        <CardContent>
          {d.payslips.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("لسه مفيش مسير رواتب متسجّل عليك.")}</p>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("الشهر")}</TableHead>
                    <TableHead className="text-start">{t("الإجمالي")}</TableHead>
                    <TableHead className="text-start">{t("الخصومات")}</TableHead>
                    <TableHead className="text-start">{t("الضريبة")}</TableHead>
                    <TableHead className="text-start">{t("الصافي")}</TableHead>
                    <TableHead className="text-start">{t("ساعات")}</TableHead>
                    <TableHead className="text-start">{t("الحالة")}</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.payslips.map((s) => (
                    <TableRow key={s.runId}>
                      <TableCell className="font-medium tabular-nums" dir="ltr">{s.period}</TableCell>
                      <TableCell className="tabular-nums">{money(s.gross)}</TableCell>
                      <TableCell className="tabular-nums">{money(s.deductions)}</TableCell>
                      <TableCell className="tabular-nums">{money(s.tax)}</TableCell>
                      <TableCell className="font-bold tabular-nums">{money(s.net)}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{s.hours == null ? "—" : s.hours}</TableCell>
                      <TableCell><Badge variant={statusTone(s.status)}>{t(STATUS_LABEL[s.status] ?? s.status)}</Badge></TableCell>
                      <TableCell>
                        {s.status === "POSTED" && (
                          <Link
                            className="text-xs text-primary hover:underline"
                            href={`/erp/hr/payroll/${encodeURIComponent(s.runNumber)}/payslip/${d.employee!.id}/print`}
                            target="_blank" rel="noopener"
                          >
                            {t("طباعة")}
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("إجازاتي")}</CardTitle>
          <CardDescription>{t("الطلبات وحالتها.")}</CardDescription>
        </CardHeader>
        <CardContent>
          {d.leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("مفيش طلبات إجازة.")}</p>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("الطلب")}</TableHead>
                    <TableHead className="text-start">{t("النوع")}</TableHead>
                    <TableHead className="text-start">{t("من")}</TableHead>
                    <TableHead className="text-start">{t("إلى")}</TableHead>
                    <TableHead className="text-start">{t("السبب")}</TableHead>
                    <TableHead className="text-start">{t("الحالة")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.leaves.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.number}</TableCell>
                      <TableCell>{t(LEAVE_LABEL[l.type] ?? l.type)}</TableCell>
                      <TableCell className="text-xs" dir="ltr">{l.startDate}</TableCell>
                      <TableCell className="text-xs" dir="ltr">{l.endDate}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">{l.reason ?? "—"}</TableCell>
                      <TableCell><Badge variant={statusTone(l.status)}>{t(STATUS_LABEL[l.status] ?? l.status)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("مطالبات المصروفات")}</CardTitle>
          <CardDescription>{t("اللي صرفته من جيبك وطلبت استرداده.")}</CardDescription>
        </CardHeader>
        <CardContent>
          {d.claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("مفيش مطالبات.")}</p>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("المطالبة")}</TableHead>
                    <TableHead className="text-start">{t("التاريخ")}</TableHead>
                    <TableHead className="text-start">{t("المبلغ")}</TableHead>
                    <TableHead className="text-start">{t("البيان")}</TableHead>
                    <TableHead className="text-start">{t("الحالة")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.claims.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.number}</TableCell>
                      <TableCell className="text-xs" dir="ltr">{c.date}</TableCell>
                      <TableCell className="font-medium tabular-nums">{money(c.amount)}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">{t(c.description ?? "—")}</TableCell>
                      <TableCell><Badge variant={statusTone(c.status)}>{t(STATUS_LABEL[c.status] ?? c.status)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
