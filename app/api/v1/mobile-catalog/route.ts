import { NAV, type NavItem } from "@/components/app-shell/nav-config";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { ALL_MODULES, getEnabledModules } from "@/lib/erp/entitlements";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { organizations, salesPlatforms } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The mobile application's navigation contract.
 *
 * This deliberately derives from the web's NAV rather than keeping a second
 * hand-maintained list in the Android project. It applies the same org module,
 * member-permission and owner-hidden-section rules as the web shell.
 */
export async function GET(req: Request) {
  // Every ERP member has settings.view; using it gives the catalog the same
  // JWT, active-org and membership checks as all other mobile endpoints.
  const auth = await authorizeApi(req, "settings.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });

  const can = (capability?: string) => {
    if (!capability) return true;
    return capability.startsWith("erp.") && auth.permissions.has(capability.slice(4));
  };
  const enabledModules = auth.role === "super_admin"
    ? new Set<string>(ALL_MODULES)
    : await getEnabledModules(auth.orgId);

  const { platforms, hidden } = await withOrgScope(auth.orgId, false, async () => {
    const [platforms, org] = await Promise.all([
      db.select({ name: salesPlatforms.name, code: salesPlatforms.code })
        .from(salesPlatforms)
        .where(and(eq(salesPlatforms.organizationId, auth.orgId), eq(salesPlatforms.isActive, true)))
        .orderBy(asc(salesPlatforms.name)),
      db.select({ hidden: organizations.navHidden })
        .from(organizations).where(eq(organizations.id, auth.orgId)).limit(1),
    ]);
    return { platforms, hidden: new Set(org[0]?.hidden ?? []) };
  });

  const amazonTools = (code: string): NavItem[] => {
    const base = `/platforms/${code.toLowerCase()}`;
    if (code.toLowerCase() !== "amazon") return [{ label: code, href: base, icon: "Store" }];
    return [
      { label: "لوحة أمازون", href: base, icon: "Store", group: "أدوات أمازون" },
      { label: "صحة أمازون", href: `${base}/health`, icon: "HeartPulse", group: "أدوات أمازون" },
      { label: "مراقبة Buy Box", href: `${base}/buy-box`, icon: "Trophy", group: "أدوات أمازون" },
      { label: "خطة FBA", href: `${base}/fba-plan`, icon: "Boxes", group: "أدوات أمازون" },
      { label: "مزامنة أمازون", href: `${base}/import`, icon: "RefreshCw", group: "المزامنة والتسويات" },
      { label: "دفعات أمازون", href: `${base}/payouts`, icon: "Landmark", group: "المزامنة والتسويات" },
      { label: "رسوم أمازون", href: `${base}/fees`, icon: "ReceiptText", group: "المزامنة والتسويات" },
      { label: "كشف أمازون", href: `${base}/statements`, icon: "FileText", group: "المزامنة والتسويات" },
      { label: "فحص المزامنة", href: `${base}/verify`, icon: "ShieldCheck", group: "المزامنة والتسويات" },
    ];
  };

  const sections = NAV
    .filter((section) => !section.heading || !hidden.has(section.heading))
    .filter((section) => !section.moduleKey || enabledModules.has(section.moduleKey))
    .filter((section) => can(section.capability))
    .map((section) => {
      const platformItems = section.dynamicKey === "platforms"
        ? platforms.flatMap((platform) => amazonTools(platform.code).map((item) => ({ ...item, label: item.label === platform.code ? platform.name : item.label })))
        : [];
      const items = [...platformItems, ...section.items]
        .filter((item) => can(item.capability))
        .map(({ label, href, icon, group }) => ({ label, href, icon, group, state: "available" as const }));
      return {
        heading: section.heading ?? null,
        href: section.href ?? null,
        icon: section.icon ?? null,
        color: section.color ?? null,
        items,
      };
    });

  return Response.json({ data: { version: "2026-10-03", sections } });
}
