"use server";

import { requireCapability } from "@/lib/session";
import { putObject, publicUrl } from "@/lib/storage";

/**
 * Uploads a screenshot for a guide and hands back its URL to drop into the markdown.
 *
 * Not org-scoped, like the rest of the academy: a screenshot of SellerCtrl belongs to
 * the product, and every tenant reads the same guide. The key namespace is `academy/`
 * so these never collide with a tenant's own uploads under `items/<orgId>/`.
 *
 * Guarded by employee.manage on top of the (admin) layout — only the platform owner
 * writes guides, and this endpoint puts bytes in a public bucket.
 */
export async function uploadAcademyImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireCapability("employee.manage");

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "لم يتم اختيار صورة" };
  if (!file.type.startsWith("image/")) return { ok: false, error: "الملف ليس صورة" };
  // Screenshots are big; a full-page PNG at 2x runs to a couple of MB.
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "حجم الصورة يتجاوز 8MB" };

  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const key = `academy/${Date.now()}-${safe}`;
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return { ok: false, error: "تعذّر رفع الصورة" };
  }
  return { ok: true, url: publicUrl(key) };
}
