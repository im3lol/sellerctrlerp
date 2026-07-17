import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listLessons, moduleCards, progress } from "@/lib/erp/academy";
import { Card, CardContent } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export const metadata = { title: "الأكاديمية" };

const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

/**
 * الأكاديمية — the index: one card per module.
 *
 * Cards rather than one long list: a flat list of every lesson rots (dozens of
 * links, no way to see what's missing), while an index answers the only question
 * someone arrives with — "where's the bit about X?" — in one glance, and makes an
 * empty module visible instead of hiding it.
 *
 * No capability gate: product documentation isn't tenant data, and reading how a
 * module works is how someone decides to buy it.
 */
export default async function AcademyPage() {
  await requireUser();

  const lessons = await listLessons();
  const cards = moduleCards(lessons);
  const p = progress(lessons);

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader icon="GraduationCap" title="الأكاديمية"
        subtitle="دروس قصيرة تشرح كل جزء في النظام — اختر الموديول" />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <p className="text-sm text-muted-foreground">
            كل درس بيقول لك تقدر تعمل إيه بعده. الدروس المعلَّمة «قريباً» بنسجّلها — لو محتاج واحد منها بسرعة قول لنا.
          </p>
          <div className="flex items-center gap-5 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold tabular-nums">{intf(p.live)}</div>
              <div className="text-xs text-muted-foreground">درس متاح</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold tabular-nums text-muted-foreground">{intf(p.soon)}</div>
              <div className="text-xs text-muted-foreground">قريباً</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const empty = c.total === 0;
          return (
            <Link
              key={c.module}
              href={empty ? "/erp/academy" : `/erp/academy/${c.module}`}
              aria-disabled={empty}
              // An empty module keeps its card — that's the honest signal nothing is
              // recorded yet — but doesn't pretend to be a link.
              className={cn(
                "rounded-xl border border-border p-5 transition-colors",
                empty ? "pointer-events-none opacity-60" : "hover:bg-muted",
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon name={c.icon} className="size-5" />
                </div>
                {c.total > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {intf(c.total)} درس
                  </span>
                )}
              </div>
              <div className="mt-3 font-semibold">{c.label}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {empty
                  ? "لا توجد دروس بعد"
                  : c.soon === 0
                    ? `${intf(c.live)} درس متاح`
                    : `${intf(c.live)} متاح · ${intf(c.soon)} قريباً`}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
