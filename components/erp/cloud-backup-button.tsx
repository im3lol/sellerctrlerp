"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { useT } from "@/lib/i18n/client";
export function CloudBackupButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}><Icon name={pending ? "LoaderCircle" : "CloudUpload"} className={pending ? "size-4 animate-spin" : "size-4"} />{pending ? t("جارٍ إضافة مهمة النسخ…") : t("حفظ نسخة الآن على Google Drive")}</Button>;
}
