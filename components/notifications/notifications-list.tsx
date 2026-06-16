"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/app/actions/notifications";
import { useRealtime } from "@/components/realtime/use-realtime";
import { relativeTimeAr } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<string, string> = {
  task_assigned: "ListChecks",
  product_assigned: "Package",
  products_distributed: "Shuffle",
  status_change: "RefreshCw",
  review_requested: "Eye",
  workspace_added: "Briefcase",
};

type N = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export function NotificationsList({ items }: { items: N[] }) {
  const router = useRouter();
  const [, start] = useTransition();

  useRealtime((e) => {
    if (e.type === "notification") router.refresh();
  });

  const open = (n: N) => {
    if (!n.readAt) start(() => markNotificationReadAction(n.id).then(() => {}));
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => start(() => markAllNotificationsReadAction().then(() => router.refresh()))}
        >
          <CheckCheck className="size-4" />
          تعليم الكل كمقروء
        </Button>
      </div>
      <div className="divide-y rounded-2xl border bg-card">
        {items.map((n) => {
          const inner = (
            <div className="flex items-start gap-3 p-4">
              <div
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl",
                  n.readAt ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <Icon name={TYPE_ICON[n.type] ?? "Bell"} className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</p>
                {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                <p className="mt-0.5 text-xs text-muted-foreground">{relativeTimeAr(n.createdAt)}</p>
              </div>
              {!n.readAt && <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}
            </div>
          );
          return n.link ? (
            <Link key={n.id} href={n.link} onClick={() => open(n)} className="block hover:bg-muted/50">
              {inner}
            </Link>
          ) : (
            <button key={n.id} onClick={() => open(n)} className="block w-full text-right hover:bg-muted/50">
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
