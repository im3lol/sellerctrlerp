import { getAttachmentContentAction } from "@/app/actions/erp/attachments";
import { presignDownload } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Download a document attachment. The action authorizes (the owning module's view cap) and
 * returns either the object storageKey or legacy inline base64. storageKey → redirect to a
 * short-lived signed URL (the binary lives in the bucket, not the DB); legacy → serve inline.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getAttachmentContentAction(id);
  if ("error" in r) return new Response(r.error, { status: 403 });

  if (r.storageKey) {
    return Response.redirect(await presignDownload(r.storageKey, 300), 302);
  }
  // Legacy row: bytes still live in the DB as base64.
  if (r.content) {
    const buf = Buffer.from(r.content, "base64");
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": r.mimeType || "application/octet-stream",
        "content-disposition": `attachment; filename="${encodeURIComponent(r.fileName)}"`,
        "cache-control": "private, no-store",
      },
    });
  }
  return new Response("Not found", { status: 404 });
}
