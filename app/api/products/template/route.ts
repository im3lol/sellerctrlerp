import { auth } from "@/auth";
import { buildTemplateBuffer } from "@/lib/excel";

export const runtime = "nodejs";

/** Download the product-import Excel template. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const buffer = buildTemplateBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sellerctrl-products-template.xlsx"',
    },
  });
}
