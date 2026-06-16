"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { useRealtime } from "@/components/realtime/use-realtime";
import { cn } from "@/lib/utils";

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const router = useRouter();

  useEffect(() => setCount(initialCount), [initialCount]);

  // Live push: increment badge + toast when a notification arrives (§15).
  useRealtime((event) => {
    if (event.type === "notification") {
      setCount((c) => c + 1);
      const p = event.payload as { title?: string; body?: string } | undefined;
      if (p?.title) toast(p.title, { description: p.body });
      router.refresh();
    }
  });

  return (
    <Link
      href="/notifications"
      className="relative grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="الإشعارات"
    >
      <Bell className="size-5" />
      {count > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -left-0.5 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
