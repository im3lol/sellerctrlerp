import {
  ordersSyncStatusAction,
  productsSyncStatusAction,
  settlementsSyncStatusAction,
  startOrdersSyncAction,
  syncProductsAction,
  syncSettlementsAction,
} from "@/app/actions/erp/marketplace-sync";
import { inventoryAuditStatusAction, startInventoryAuditAction } from "@/app/actions/erp/fba-inventory";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { orgHasModule } from "@/lib/erp/entitlements";
import { getAmazonPlatform } from "@/lib/erp/mobile-marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncKinds = ["products", "orders", "settlements", "inventory"] as const;
type SyncKind = (typeof syncKinds)[number];

function isSyncKind(value: unknown): value is SyncKind {
  return typeof value === "string" && (syncKinds as readonly string[]).includes(value);
}

function permissionFor(kind: SyncKind) {
  if (kind === "settlements") return "accounting.create" as const;
  if (kind === "inventory") return "inventory.view" as const;
  return "sales.create" as const;
}

async function authorizeAmazonSync(req: Request, code: string, kind: SyncKind) {
  const auth = await authorizeApi(req, permissionFor(kind));
  if (isApiError(auth)) return { response: Response.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role !== "super_admin" && !(await orgHasModule(auth.orgId, "marketplace"))) {
    return { response: Response.json({ error: "module_unavailable" }, { status: 403 }) };
  }
  return { auth };
}

/** Start a non-blocking Amazon import. Progress is fetched separately by the app. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  if (!isSyncKind(kind)) return Response.json({ error: "invalid_sync_kind" }, { status: 400 });
  const { code } = await params;
  const result = await authorizeAmazonSync(req, code, kind);
  if ("response" in result) return result.response;

  return runAsErp(result.auth, async () => {
    const platform = await getAmazonPlatform(result.auth.orgId, code);
    if (!platform) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    const action = kind === "products" ? await syncProductsAction(platform.code)
      : kind === "orders" ? await startOrdersSyncAction(platform.code)
      : kind === "settlements" ? await syncSettlementsAction(platform.code)
      : await startInventoryAuditAction(platform.code);
    return Response.json({ kind, ...action }, { status: action.ok ? 200 : 400 });
  });
}

/** Poll import state. It intentionally never runs an import itself. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (!isSyncKind(kind)) return Response.json({ error: "invalid_sync_kind" }, { status: 400 });
  const { code } = await params;
  const result = await authorizeAmazonSync(req, code, kind);
  if ("response" in result) return result.response;

  return runAsErp(result.auth, async () => {
    const platform = await getAmazonPlatform(result.auth.orgId, code);
    if (!platform) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    const status = kind === "products" ? await productsSyncStatusAction(platform.code)
      : kind === "orders" ? await ordersSyncStatusAction(platform.code)
      : kind === "settlements" ? await settlementsSyncStatusAction(platform.code)
      : await inventoryAuditStatusAction(platform.code);
    return Response.json({ data: { kind, ...status } });
  });
}
