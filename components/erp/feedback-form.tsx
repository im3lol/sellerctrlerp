"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { submitFeedbackAction } from "@/app/actions/erp/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const KINDS = [
  { value: "suggestion", label: "اقتراح", hint: "حاجة نضيفها أو نحسّنها" },
  { value: "complaint", label: "شكوى", hint: "حاجة مضايقاك أو مش شغالة" },
] as const;

export function FeedbackForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"suggestion" | "complaint">("suggestion");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const submit = () => start(async () => {
    const res = await submitFeedbackAction({ kind, subject, message });
    if ("ok" in res) {
      toast.success("وصلنا — شكرًا. هترد عليك من هنا.");
      setSubject(""); setMessage(""); setKind("suggestion");
      router.refresh();
    } else toast.error(res.error);
  });

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1.5">
          <Label>النوع</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button key={k.value} type="button" onClick={() => setKind(k.value)}
                className={cn(
                  "rounded-lg border p-3 text-right transition-colors",
                  kind === k.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                )}>
                <div className="text-sm font-medium">{k.label}</div>
                <div className="text-xs text-muted-foreground">{k.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="subject">الموضوع</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="مثلاً: عايز أطبع الفاتورة بشعار الشركة" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="message">التفاصيل</Label>
          <Textarea id="message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="اشرح المشكلة أو الفكرة — لو شكوى، قول لنا كنت بتعمل إيه بالظبط لما حصلت." />
          <p className="text-xs text-muted-foreground">
            كل ما التفاصيل تزيد كل ما الرد يبقى أسرع وأدق.
          </p>
        </div>

        <Button onClick={submit} disabled={pending || subject.length < 3 || message.length < 10}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} إرسال
        </Button>
      </CardContent>
    </Card>
  );
}
