import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/empty-state";
import { relativeTimeAr } from "@/lib/format";
import type { ActivityItem } from "@/lib/queries/activity";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <EmptyState icon="Activity" title="لا يوجد نشاط بعد" />;
  }
  return (
    <ol className="space-y-1">
      {items.map((it) => {
        const initials = (it.actorName ?? "؟").split(" ").slice(0, 2).map((p) => p[0]).join("");
        return (
          <li key={it.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-muted/50">
            <Avatar className="size-8">
              {it.actorAvatar && <AvatarImage src={it.actorAvatar} />}
              <AvatarFallback className="bg-primary/10 text-xs text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{it.summaryAr}</p>
              <p className="text-xs text-muted-foreground">{relativeTimeAr(it.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
