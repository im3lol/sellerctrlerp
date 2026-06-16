import { listComments, type EntityType } from "@/lib/queries/comments";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AddCommentForm } from "@/components/comments/add-comment-form";
import { relativeTimeAr } from "@/lib/format";

export async function CommentsSection({
  entityType,
  entityId,
  workspaceId,
}: {
  entityType: EntityType;
  entityId: string;
  workspaceId?: string | null;
}) {
  const items = await listComments(entityType, entityId);

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد تعليقات بعد. كن أول من يعلّق.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => {
            const init = (c.authorName ?? "؟").split(" ").slice(0, 2).map((p) => p[0]).join("");
            return (
              <li key={c.id} className="flex gap-3">
                <Avatar className="size-8">
                  {c.authorAvatar && <AvatarImage src={c.authorAvatar} />}
                  <AvatarFallback className="bg-primary/10 text-xs text-primary">{init}</AvatarFallback>
                </Avatar>
                <div className="flex-1 rounded-2xl bg-muted/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.authorName}</span>
                    <span className="text-xs text-muted-foreground">{relativeTimeAr(c.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AddCommentForm entityType={entityType} entityId={entityId} workspaceId={workspaceId} />
    </div>
  );
}
