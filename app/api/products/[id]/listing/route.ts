import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { products, productBases } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { canAccessWorkspace } from "@/lib/workspaces";
import { buildListingMarkdown } from "@/lib/listing";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const [p] = await db
    .select({
      workspaceId: products.workspaceId,
      assignedTo: products.assignedTo,
      name: productBases.name,
      description: productBases.description,
      features: productBases.features,
      sizes: productBases.sizes,
      colors: productBases.colors,
      brand: productBases.brand,
      price: productBases.price,
      productUrl: productBases.productUrl,
      imageUrl: productBases.imageUrl,
    })
    .from(products)
    .leftJoin(productBases, eq(products.baseId, productBases.id))
    .where(eq(products.id, id))
    .limit(1);
  if (!p) return new Response("Not found", { status: 404 });

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  // Access: managers/leads via workspace; the assigned employee for their product.
  const allowed = (await canAccessWorkspace(user, p.workspaceId)) || p.assignedTo === user.id;
  if (!allowed) return new Response("Forbidden", { status: 403 });

  const md = buildListingMarkdown({
    name: p.name ?? "",
    description: p.description,
    features: p.features,
    sizes: p.sizes,
    colors: p.colors,
    brand: p.brand,
    price: p.price,
    productUrl: p.productUrl,
    imageUrl: p.imageUrl,
  });

  const download = new URL(req.url).searchParams.get("download") === "1";
  const safe = (p.name ?? "product").replace(/[^\w؀-ۿ.\-]+/g, "_").slice(0, 40);
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ...(download ? { "Content-Disposition": `attachment; filename="listing-${safe}.md"` } : {}),
    },
  });
}
