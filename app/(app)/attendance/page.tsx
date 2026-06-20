import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getTodaySnapshot } from "@/lib/attendance";
import {
  getAttendanceSummary,
  listRecentSessions,
  listTeamToday,
} from "@/lib/queries/attendance";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { AttendanceClock } from "@/components/attendance/attendance-clock";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatHMS, formatDurationAr } from "@/components/attendance/format";
import { formatDateAr } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function AttendancePage() {
  const user = await requireUser();
  const [snap, summary, sessions] = await Promise.all([
    getTodaySnapshot(user.id),
    getAttendanceSummary(user.id),
    listRecentSessions(user.id),
  ]);
  const team = can(user.role, "attendance.viewAll") ? await listTeamToday() : null;

  return (
    <div>
      <PageHeader title="الحضور والانصراف" description="سجّل دوامك وتابع ساعات عملك" />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex items-center justify-center p-8 lg:col-span-1">
          <AttendanceClock initial={snap} />
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="ساعات اليوم" value={formatDurationAr(summary.today)} icon="Clock" tone="yellow" />
            <StatCard label="ساعات الأسبوع" value={formatDurationAr(summary.week)} icon="CalendarDays" tone="blue" />
            <StatCard label="ساعات الشهر" value={formatDurationAr(summary.month)} icon="CalendarRange" tone="purple" />
          </div>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">آخر الجلسات</h2>
            <div className="divide-y">
              {sessions.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">لا توجد جلسات بعد</p>}
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{formatDateAr(s.workDate)}</span>
                  <span className="font-mono text-muted-foreground" dir="ltr">
                    {new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(s.clockIn)}
                    {s.clockOut && ` — ${new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(s.clockOut)}`}
                  </span>
                  <span className="font-mono font-semibold tabular-nums" dir="ltr">{formatHMS(s.worked)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {team && (
        <Card className="mt-6 p-5">
          <h2 className="mb-3 font-semibold">حضور الفريق اليوم</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((m) => {
              const init = m.name.split(" ").slice(0, 2).map((p) => p[0]).join("");
              return (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border p-3">
                  <Avatar className="size-9">
                    {m.avatarUrl && <AvatarImage src={m.avatarUrl} />}
                    <AvatarFallback className="bg-primary/10 text-primary">{init}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="font-mono text-xs text-muted-foreground" dir="ltr">{formatHMS(m.worked)}</p>
                  </div>
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      m.status === "working" ? "bg-success" : m.status === "break" ? "bg-warning" : "bg-muted-foreground/30",
                    )}
                    title={m.status === "working" ? "يعمل" : m.status === "break" ? "استراحة" : "خارج الدوام"}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
