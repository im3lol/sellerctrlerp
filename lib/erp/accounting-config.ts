import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, accountingConfigurations } from "@/db/schema";

/**
 * Default chart-of-accounts code that each configurable posting "role" overrides.
 * When `accounting_configurations` has a non-null account for the field, that
 * account replaces the default-coded one in every posting path that uses the
 * code; otherwise the default code is resolved as before. So with an empty
 * config (the seed default) behaviour is byte-identical to hardcoded codes —
 * the GL == ledger invariant and all chk-* tests are preserved by construction.
 *
 * `purchaseAccountId` is intentionally absent: purchases capitalise into the
 * inventory account (1104), there is no standalone purchases code in the posting
 * paths, so the stored value is unused (documented gap).
 */
const FIELD_FOR_CODE: Record<string, keyof Override> = {
  "1103": "receivableAccountId",
  "2101": "payableAccountId",
  "1101": "cashAccountId",
  "1102": "bankAccountId",
  "4101": "salesAccountId",
  "1104": "inventoryAccountId",
  "5101": "cogsAccountId",
  "2102": "outputTaxAccountId",
  "1107": "inputTaxAccountId",
};

type Override = {
  receivableAccountId: string | null;
  payableAccountId: string | null;
  cashAccountId: string | null;
  bankAccountId: string | null;
  salesAccountId: string | null;
  inventoryAccountId: string | null;
  cogsAccountId: string | null;
  outputTaxAccountId: string | null;
  inputTaxAccountId: string | null;
};

/**
 * Resolve a `code → accountId` map for an org, applying any configured account
 * overrides on top of the default chart-of-accounts codes. Drop-in replacement
 * for the inline `db.select(...).where(inArray(accounts.code, codes))` +
 * `Object.fromEntries` pattern in the posting actions.
 */
export async function resolveAccountIds(
  orgId: string,
  codes: string[],
  exec: Pick<typeof db, "select"> = db,
): Promise<Record<string, string>> {
  const [accs, [config]] = await Promise.all([
    exec
      .select({ code: accounts.code, id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, codes))),
    exec
      .select()
      .from(accountingConfigurations)
      .where(eq(accountingConfigurations.organizationId, orgId))
      .limit(1),
  ]);

  const byCode: Record<string, string> = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  if (config) {
    for (const code of codes) {
      const field = FIELD_FOR_CODE[code];
      if (!field) continue;
      const override = (config as Override)[field];
      if (override) byCode[code] = override;
    }
  }

  return byCode;
}
