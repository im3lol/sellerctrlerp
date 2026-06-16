"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, Download, FileText, Image as ImageIcon, FileSpreadsheet, File, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { uploadFileAction, deleteFileAction } from "@/app/actions/files";
import { Button } from "@/components/ui/button";
import { formatDateAr } from "@/lib/format";

type FileItem = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  url: string;
  createdAt: Date;
  uploaderName: string | null;
};

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.includes("pdf")) return FileText;
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) return FileSpreadsheet;
  return File;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileManager({
  workspaceId,
  files,
  canManage,
}: {
  workspaceId: string;
  files: FileItem[];
  canManage: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    start(async () => {
      const res = await uploadFileAction(workspaceId, fd);
      if (res.ok) {
        toast.success("تم رفع الملف");
        router.refresh();
      } else toast.error(res.error ?? "تعذّر الرفع");
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  const remove = (id: string) =>
    start(async () => {
      try {
        await deleteFileAction(id);
        toast.success("تم حذف الملف");
        router.refresh();
      } catch {
        toast.error("تعذّر الحذف");
      }
    });

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <input ref={inputRef} type="file" className="hidden" onChange={onFile} />
          <Button onClick={() => inputRef.current?.click()} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            رفع ملف
          </Button>
        </div>
      )}

      {files.length === 0 ? (
        <p className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          لا توجد ملفات. ارفع PDF أو Excel أو صوراً أو مستندات.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => {
            const Icon = fileIcon(f.mime);
            return (
              <div key={f.id} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(f.sizeBytes)} · {formatDateAr(f.createdAt)}
                  </p>
                </div>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
                >
                  <Download className="size-4" />
                </a>
                {canManage && (
                  <button
                    onClick={() => remove(f.id)}
                    disabled={pending}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
