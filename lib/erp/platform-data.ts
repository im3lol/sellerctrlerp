import { asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, orgSubscriptions, activationCodes } from "@/db/schema";

export type CustomerRow = {
  id: string; name: string; email: string | null;
  status: string; interval: string | null; planName: string | null; price: number;
  modules: string[]; startedAt: string | null; expiresAt: string | null; daysLeft: number | null; live: boolean;
};
export type CodeRow = {
  id: string; hint: string; interval: string; durationMonths: number; modules: string[];
  planName: string | null; price: number; status: string; orgName: string | null;
  redeemedAt: string | null; expiresAt: string | null; createdAt: string;
};

const DAY = 86_400_000;

/** Load every customer org with its subscription + all activation codes. Shared
 *  by all /platform pages. */
export async function getPlatformData(): Promise<{ customers: CustomerRow[]; codes: CodeRow[] }> {
  const [orgs, subs, codes] = await Promise.all([
    db.select({ id: organizations.id, nameAr: organizations.nameAr, email: organizations.email, createdAt: organizations.createdAt })
      .from(organizations).orderBy(asc(organizations.createdAt)),
    db.select().from(orgSubscriptions),
    db.select().from(activationCodes).orderBy(desc(activationCodes.createdAt)),
  ]);

  const subByOrg = new Map(subs.map((s) => [s.organizationId, s]));
  const now = Date.now();

  const customers: CustomerRow[] = orgs.map((o) => {
    const s = subByOrg.get(o.id);
    const expiresAt = s?.expiresAt ? new Date(s.expiresAt).getTime() : null;
    const live = !!s && (s.status === "ACTIVE" || s.status === "TRIAL") && (!expiresAt || expiresAt > now);
    return {
      id: o.id, name: o.nameAr, email: o.email ?? null,
      status: s?.status ?? "NONE", interval: s?.interval ?? null, planName: s?.planName ?? null,
      price: Number(s?.price ?? 0), modules: s?.enabledModules ?? [],
      startedAt: s?.startedAt ? new Date(s.startedAt).toISOString() : null,
      expiresAt: s?.expiresAt ? new Date(s.expiresAt).toISOString() : null,
      daysLeft: expiresAt ? Math.ceil((expiresAt - now) / DAY) : null, live,
    };
  });

  const codeRows: CodeRow[] = codes.map((c) => ({
    id: c.id, hint: c.codeHint, interval: c.interval, durationMonths: c.durationMonths,
    modules: c.enabledModules ?? [], planName: c.planName ?? null, price: Number(c.price), status: c.status,
    orgName: c.organizationId ? (orgs.find((o) => o.id === c.organizationId)?.nameAr ?? "—") : null,
    redeemedAt: c.redeemedAt ? new Date(c.redeemedAt).toISOString() : null,
    expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
    createdAt: new Date(c.createdAt).toISOString(),
  }));

  return { customers, codes: codeRows };
}

/** Headline numbers for the platform overview. */
export function platformStats(customers: CustomerRow[], codes: CodeRow[]) {
  const active = customers.filter((c) => c.live);
  const unlicensed = customers.filter((c) => c.status === "NONE").length;
  const mrr = active.reduce((s, c) => s + (c.interval === "MONTHLY" ? c.price : c.interval === "ANNUAL" ? c.price / 12 : 0), 0);
  return {
    customers: customers.length,
    active: active.length,
    unlicensed,
    mrr,
    arr: mrr * 12,
    expiringSoon: active.filter((c) => c.daysLeft != null && c.daysLeft <= 30).length,
    monthly: active.filter((c) => c.interval === "MONTHLY").length,
    annual: active.filter((c) => c.interval === "ANNUAL").length,
    cancelled: customers.filter((c) => c.status === "CANCELLED").length,
    codesUnused: codes.filter((c) => c.status === "UNUSED").length,
    codesTotal: codes.length,
  };
}
