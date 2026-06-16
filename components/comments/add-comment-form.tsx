"use client";

import { useState, useTransition } from "react";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addCommentAction } from "@/app/actions/comments";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function AddCommentForm({
  entityType,
  entityId,
  workspaceId,
}: {
  entityType: "product" | "task" | "workspace";
  entityId: string;
  workspaceId?: string | null;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (!body.trim()) return;
    start(async () => {
      const res = await addCommentAction(entityType, entityId, body, workspaceId);
      if (res.ok) setBody("");
      else toast.error(res.error ?? "تعذّر إضافة التعليق");
    });
  };

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="اكتب تعليقاً…"
        rows={2}
        className="flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <Button onClick={submit} disabled={pending || !body.trim()} size="icon" className="shrink-0">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      </Button>
    </div>
  );
}
