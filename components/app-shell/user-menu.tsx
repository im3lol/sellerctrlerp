"use client";

import { LogOut, User as UserIcon, ShieldCheck, CreditCard } from "lucide-react";
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
import { setLocaleAction } from "@/app/actions/locale";
import { useLocale, useT } from "@/lib/i18n/client";
import { LOCALE_LABEL, LOCALES } from "@/lib/i18n";
import { Languages } from "lucide-react";
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
  const t = useT();
  const locale = useLocale();
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
            {t("الملف الشخصي")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/settings/subscription" className="cursor-pointer">
            <CreditCard className="size-4" />
            {t("الاشتراك والباقة")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/settings/security" className="cursor-pointer">
            <ShieldCheck className="size-4" />
            {t("الأمان وكلمة المرور")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Language is a per-person choice, so it belongs to the person's own menu. */}
        {LOCALES.filter((l) => l !== locale).map((l) => (
          <DropdownMenuItem key={l} className="cursor-pointer" onSelect={() => { void setLocaleAction(l); }}>
            <Languages className="size-4" />
            {LOCALE_LABEL[l]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onSelect={() => signOutAction()}
        >
          <LogOut className="size-4" />
          {t("تسجيل الخروج")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
