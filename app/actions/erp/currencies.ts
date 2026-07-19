"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { currencies, exchangeRates } from "@/db/schema";
import { parseDate } from "@/lib/erp/dates";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

/* ── Currencies ──────────────────────────────────────────── */

export type CurrencyInput = {
  code: string;
  nameAr: string;
  symbol: string;
  isBase?: boolean;
  currentRate?: number;
};

export async function upsertCurrencyAction(input: CurrencyInput): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const code = input.code.toUpperCase().trim();
    if (!code || code.length < 2 || code.length > 5) return { error: "كود العملة يجب أن يكون 2-5 أحرف" };

    const rate = input.currentRate && input.currentRate > 0 ? input.currentRate : 1;

    try {
      if (input.isBase) {
        await db
          .update(currencies)
          .set({ isBase: false })
          .where(and(eq(currencies.organizationId, auth.orgId), eq(currencies.isBase, true)));
      }

      await db
        .insert(currencies)
        .values({
          organizationId: auth.orgId,
          code,
          nameAr: input.nameAr.trim(),
          nameEn: input.nameAr.trim(),
          symbol: input.symbol.trim(),
          isBase: input.isBase ?? false,
          exchangeRate: String(rate),
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [currencies.organizationId, currencies.code],
          set: {
            nameAr: input.nameAr.trim(),
            nameEn: input.nameAr.trim(),
            symbol: input.symbol.trim(),
            isBase: input.isBase ?? false,
            exchangeRate: String(rate),
            isActive: true,
          },
        });
    } catch {
      return { error: "تعذّر حفظ العملة" };
    }
    revalidatePath("/settings/currencies");
    return { ok: true };
  });
}

export async function toggleCurrencyActiveAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [cur] = await db
      .select()
      .from(currencies)
      .where(and(eq(currencies.id, id), eq(currencies.organizationId, auth.orgId)))
      .limit(1);
    if (!cur) return { error: "العملة غير موجودة" };
    if (cur.isBase) return { error: "لا يمكن إلغاء تفعيل العملة الأساسية" };

    await db.update(currencies).set({ isActive: !cur.isActive }).where(eq(currencies.id, id));
    revalidatePath("/settings/currencies");
    return { ok: true };
  });
}

/* ── Exchange Rates ──────────────────────────────────────── */

export type RateInput = {
  currencyCode: string;
  date: string;
  rate: number;
};

export async function upsertExchangeRateAction(input: RateInput): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    if (input.rate <= 0) return { error: "سعر الصرف يجب أن يكون أكبر من صفر" };
    const date = parseDate(input.date);
    if (!date) return { error: "التاريخ غير صالح" };

    const code = input.currencyCode.toUpperCase();

    try {
      await db
        .insert(exchangeRates)
        .values({
          organizationId: auth.orgId,
          currencyCode: code,
          date,
          rate: String(input.rate),
          createdById: auth.userId,
        })
        .onConflictDoUpdate({
          target: [exchangeRates.organizationId, exchangeRates.currencyCode, exchangeRates.date],
          set: { rate: String(input.rate), createdById: auth.userId },
        });

      // Also update the current rate snapshot on the currencies row for quick lookups
      await db
        .update(currencies)
        .set({ exchangeRate: String(input.rate) })
        .where(and(eq(currencies.organizationId, auth.orgId), eq(currencies.code, code)));
    } catch {
      return { error: "تعذّر حفظ سعر الصرف" };
    }
    revalidatePath("/settings/currencies");
    return { ok: true };
  });
}
