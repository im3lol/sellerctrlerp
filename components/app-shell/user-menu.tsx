"use client";

import { LogOut, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/actions/auth";
import { ROLE_LABELS_AR, type Role } from "@/lib/rbac";

export function UserMenu({
  name,
  email,
  role,
  title,
  avatarUrl,
}: {
  name: string;
  email: string;
  role: Role;
  title?: string | null;
  avatarUrl?: string | null;
}) {
  const initials = name.split(" ").slice(0, 2).map((p) => p[0]).join("");
  // Prefer the job title; fall back to the role label. Hide if it duplicates the name.
  const subtitle = title && title !== name ? title : ROLE_LABELS_AR[role] !== name ? ROLE_LABELS_AR[role] : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-9 border">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
          <AvatarFallback className="bg-primary/10 text-primary font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="hidden text-right leading-tight md:block">
          <p className="text-sm font-semibold">{name}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="font-semibold">{name}</p>
          <p className="text-xs font-normal text-muted-foreground" dir="ltr">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/profile" className="cursor-pointer">
            <UserIcon className="size-4" />
            الملف الشخصي
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onSelect={() => signOutAction()}
        >
          <LogOut className="size-4" />
          تسجيل الخروج
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
