"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "products", label: "المنتجات" },
  { key: "team", label: "الفريق" },
  { key: "tasks", label: "المهام" },
  { key: "files", label: "الملفات" },
  { key: "activity", label: "النشاط" },
];

export function WorkspaceTabBar({ active }: { active: string }) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div className="mb-5 flex gap-1 border-b">
      {TABS.map((t) => {
        const isActive = (active || "products") === t.key;
        const next = new URLSearchParams(params.toString());
        next.set("tab", t.key);
        return (
          <Link
            key={t.key}
            href={`${pathname}?${next.toString()}`}
            className={cn(
              "relative px-4 py-2.5 text-sm font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {isActive && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
