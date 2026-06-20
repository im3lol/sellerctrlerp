"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveOrgAction } from "@/app/actions/org";
import { cn } from "@/lib/utils";

type Org = { id: string; nameAr: string };

export function OrgSwitcher({ orgs = [], activeId }: { orgs?: Org[]; activeId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(activeId);

  if (orgs.length === 0) return null;
  const active = orgs.find((o) => o.id === current) ?? orgs[0];

  const select = (id: string) => {
    if (id === current) return;
    setCurrent(id);
    startTransition(async () => {
      await setActiveOrgAction(id);
      router.refresh();
    });
  };

  // Single org: show it as a static chip (no menu needed).
  if (orgs.length === 1) {
    return (
      <div className="hidden items-center gap-2 rounded-xl border bg-muted/40 px-3 py-1.5 text-sm font-medium sm:flex">
        <Building2 className="size-4 text-primary" />
        <span className="max-w-[160px] truncate">{active.nameAr}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent",
          pending && "opacity-60",
        )}
      >
        <Building2 className="size-4 text-primary" />
        <span className="max-w-[160px] truncate">{active.nameAr}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>المؤسسة النشطة</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => select(o.id)} className="gap-2">
            <Check className={cn("size-4", o.id === active.id ? "opacity-100 text-primary" : "opacity-0")} />
            <span className="truncate">{o.nameAr}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
