"use client";

import { Menu, Search } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NavList } from "@/components/app-shell/nav-list";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { AttendanceQuickToggle } from "@/components/attendance/attendance-quick-toggle";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import type { Role } from "@/lib/rbac";
import type { AttendanceSnapshot } from "@/lib/attendance";

export function Topbar({
  user,
  unreadCount,
  attendance,
}: {
  user: { name: string; email: string; role: Role; title?: string | null; avatarUrl?: string | null };
  unreadCount: number;
  attendance: AttendanceSnapshot;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
      {/* Mobile menu */}
      <Sheet>
        <SheetTrigger className="grid size-10 place-items-center rounded-lg hover:bg-accent lg:hidden">
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="right" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">القائمة</SheetTitle>
          <div className="flex h-16 items-center px-6">
            <Logo className="text-2xl text-sidebar-foreground" />
          </div>
          <NavList role={user.role} />
        </SheetContent>
      </Sheet>

      {/* Search (start / right in RTL) */}
      <div className="relative hidden w-full max-w-xs md:block">
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="بحث…" className="bg-muted/50 pr-9" />
      </div>

      {/* Actions (pushed to the end / left in RTL) */}
      <div className="ms-auto flex items-center gap-2">
        <AttendanceQuickToggle initial={attendance} />
        <NotificationBell initialCount={unreadCount} />
        <div className="mx-1 hidden h-8 w-px bg-border sm:block" />
        <UserMenu
          name={user.name}
          email={user.email}
          role={user.role}
          title={user.title}
          avatarUrl={user.avatarUrl}
        />
      </div>
    </header>
  );
}
