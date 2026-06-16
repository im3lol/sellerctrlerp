import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { notifications } from "@/db/schema";
import { getTodaySnapshot } from "@/lib/attendance";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import type { Role } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role === "client") redirect("/portal");

  const [[{ count }], attendanceSnap] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    getTodaySnapshot(user.id),
  ]);

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar role={user.role as Role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={{
            name: user.name,
            email: user.email,
            role: user.role as Role,
            title: user.title,
            avatarUrl: user.avatarUrl,
          }}
          unreadCount={count ?? 0}
          attendance={attendanceSnap}
        />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
