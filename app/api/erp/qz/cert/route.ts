import { getCurrentUser } from "@/lib/session";
import { qzCertificate } from "@/lib/erp/qz-sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/erp/qz/cert — the public certificate. Two consumers:
 *  1. qz-tray's setCertificatePromise (fetch().text() — Content-Disposition is inert there).
 *  2. The "download certificate" link on /settings/printing, so a customer can self-serve
 *     importing it into QZ Tray's Site Manager without asking a developer for the file.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  return new Response(qzCertificate(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sellerctrl-qz-certificate.txt"',
      "Cache-Control": "no-store",
    },
  });
}
