"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
export function StorageBackupButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t("جارٍ إنشاء النسخة…") : t("إنشاء نسخة محفوظة الآن")}</Button>;
}
