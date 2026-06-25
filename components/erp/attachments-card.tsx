"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { getAttachmentsAction, addAttachmentAction, deleteAttachmentAction, getAttachmentContentAction, type AttachmentMeta } from "@/app/actions/erp/attachments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_MB = 10;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string) {
  if (mime === "application/pdf") return "FileText";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "Table2";
  if (mime.includes("word")) return "FileText";
  return "Paperclip";
}

export function AttachmentsCard({ entityType, entityId, canManage }: { entityType: string; entityId: string; canManage: boolean }) {
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [loadPending, startLoad] = useTransition();
  const [uploadPending, startUpload] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = () => {
    startLoad(async () => {
      const r = await getAttachmentsAction(entityType, entityId);
      if (!("error" in r)) setAttachments(r);
    });
  };

  useEffect(() => { load(); }, [entityType, entityId]);

  const upload = (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("نوع الملف غير مدعوم (PDF / صورة / Office فقط)");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`حجم الملف لا يجب أن يتجاوز ${MAX_MB} ميجابايت`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      startUpload(async () => {
        const r = await addAttachmentAction(entityType, entityId, file.name, file.type, base64);
        if ("error" in r) { toast.error(r.error); return; }
        toast.success("تم رفع المرفق");
        load();
      });
    };
    reader.readAsDataURL(file);
  };

  const download = (att: AttachmentMeta) => {
    startLoad(async () => {
      const r = await getAttachmentContentAction(att.id);
      if ("error" in r) { toast.error(r.error); return; }
      const byteChars = atob(r.content);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const blob = new Blob([bytes], { type: r.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = r.fileName; a.click();
      URL.revokeObjectURL(url);
    });
  };

  const remove = (id: string) => {
    startDelete(async () => {
      const r = await deleteAttachmentAction(id);
      if ("error" in r) { toast.error(r.error); return; }
      toast.success("تم حذف المرفق");
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>المرفقات</CardTitle>
            <CardDescription>{attachments.length} ملف مرفق</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadPending}>
              <Icon name={uploadPending ? "Loader2" : "Paperclip"} className={`size-4 ${uploadPending ? "animate-spin" : ""}`} />
              إرفاق ملف
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div
            className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm text-muted-foreground cursor-pointer transition-colors
              ${dragOver ? "border-primary bg-primary/5" : "border-muted hover:border-primary/40"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="Upload" className="size-4" />
            اسحب ملفًا هنا أو انقر للرفع (PDF · صورة · Office · حد {MAX_MB} MB)
          </div>
        )}
        <input ref={fileRef} type="file" className="hidden" accept={ALLOWED_TYPES.join(",")}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />

        {loadPending && attachments.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Icon name="Loader2" className="size-4 animate-spin" />جارٍ التحميل...
          </div>
        )}

        {!loadPending && attachments.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مرفقات بعد.</p>
        )}

        {attachments.map((att) => (
          <div key={att.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <Icon name={fileIcon(att.mimeType)} className="size-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{att.fileName}</p>
              <p className="text-xs text-muted-foreground">{formatSize(att.fileSize)} · {new Date(att.createdAt).toLocaleDateString("en-GB")}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="icon" variant="ghost" className="size-8" onClick={() => download(att)} title="تحميل">
                <Icon name="Download" className="size-4" />
              </Button>
              {canManage && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="size-8" disabled={deletePending} title="حذف">
                      <Icon name="Trash2" className="size-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>حذف «{att.fileName}»؟</AlertDialogTitle>
                      <AlertDialogDescription>لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>إلغاء</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(att.id)}>حذف</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
