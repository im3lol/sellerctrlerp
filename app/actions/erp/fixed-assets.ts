"use server";

import { and, eq, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireErpModule } from "@/lib/erp/org";
import { fixedAssets, assetDepreciationLines } from "@/db/schema";
import type { ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── Create asset ──────────────────────────────────────────── */
export async function createAssetAction(input: {
  code: string;
  nameAr: string;
  category: string;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue?: number;
  usefulLifeYears: number;
  glAssetAccountId?: string;
  glAccumDeprecAccountId?: string;
  glDeprecExpenseAccountId?: string;
  notes?: string;
}): Promise<ActionState & { id?: string }> {
  const { orgId } = await requireErpModule("accounting.create");

  const cost = input.purchaseCost;
  const salvage = input.salvageValue ?? 0;

  const [row] = await db.insert(fixedAssets).values({
    organizationId: orgId,
    code: input.code.trim(),
    nameAr: input.nameAr.trim(),
    category: input.category,
    purchaseDate: new Date(input.purchaseDate),
    purchaseCost: String(cost),
    salvageValue: String(salvage),
    usefulLifeYears: input.usefulLifeYears,
    netBookValue: String(cost),
    glAssetAccountId: input.glAssetAccountId || null,
    glAccumDeprecAccountId: input.glAccumDeprecAccountId || null,
    glDeprecExpenseAccountId: input.glDeprecExpenseAccountId || null,
    notes: input.notes?.trim() || null,
  }).returning({ id: fixedAssets.id });

  revalidatePath("/erp/accounting/assets");
  return { ok: true, id: row.id };
}

/* ── Post depreciation for one period ─────────────────────── */
export async function postMonthlyDepreciationAction(input: {
  year: number;
  month: number; // 1-12
}): Promise<ActionState & { count?: number }> {
  const { orgId } = await requireErpModule("accounting.post");
  const userId = null;
  const { year, month } = input;

  // Find all ACTIVE assets for this org with at least one GL account linked
  const assets = await db
    .select()
    .from(fixedAssets)
    .where(
      and(
        eq(fixedAssets.organizationId, orgId),
        eq(fixedAssets.status, "ACTIVE"),
        lte(fixedAssets.purchaseDate, new Date(year, month, 0)), // purchased before end of period
      ),
    );

  if (!assets.length) return { ok: true, count: 0 };

  let posted = 0;

  await db.transaction(async (tx) => {
    for (const asset of assets) {
      const alreadyPosted = await tx
        .select({ id: assetDepreciationLines.id })
        .from(assetDepreciationLines)
        .where(
          and(
            eq(assetDepreciationLines.assetId, asset.id),
            eq(assetDepreciationLines.periodYear, year),
            eq(assetDepreciationLines.periodMonth, month),
          ),
        )
        .limit(1);
      if (alreadyPosted.length) continue;

      const annual = (Number(asset.purchaseCost) - Number(asset.salvageValue)) / asset.usefulLifeYears;
      const monthly = round2(annual / 12);
      if (monthly <= 0) continue;

      // Cap at remaining depreciable amount
      const remaining = Number(asset.purchaseCost) - Number(asset.salvageValue) - Number(asset.accumulatedDepreciation);
      if (remaining <= 0) {
        await tx.update(fixedAssets).set({ status: "FULLY_DEPRECIATED", updatedAt: new Date() }).where(eq(fixedAssets.id, asset.id));
        continue;
      }
      const amount = round2(Math.min(monthly, remaining));

      // Post GL if accounts are configured
      let jeId: string | null = null;
      if (asset.glDeprecExpenseAccountId && asset.glAccumDeprecAccountId) {
        const periodDate = new Date(year, month - 1, 28);
        jeId = await postEntry(tx, {
          orgId,
          userId,
          sourceType: "DEPRECIATION",
          sourceId: `${asset.id}:${year}:${month}`,
          date: periodDate,
          description: `إهلاك: ${asset.nameAr} (${year}/${String(month).padStart(2, "0")})`,
          lines: [
            { accountId: asset.glDeprecExpenseAccountId, debit: amount, credit: 0, description: asset.nameAr },
            { accountId: asset.glAccumDeprecAccountId,   debit: 0, credit: amount, description: asset.nameAr },
          ],
        });
      }

      // Record depreciation line
      await tx.insert(assetDepreciationLines).values({
        organizationId: orgId,
        assetId: asset.id,
        periodYear: year,
        periodMonth: month,
        amount: String(amount),
        journalEntryId: jeId,
      });

      // Update asset accumulated depreciation
      const newAccum = round2(Number(asset.accumulatedDepreciation) + amount);
      const newNBV   = round2(Number(asset.purchaseCost) - newAccum);
      const newStatus = newNBV <= Number(asset.salvageValue) + 0.01 ? "FULLY_DEPRECIATED" : "ACTIVE";

      await tx.update(fixedAssets).set({
        accumulatedDepreciation: String(newAccum),
        netBookValue: String(newNBV),
        status: newStatus,
        updatedAt: new Date(),
      }).where(eq(fixedAssets.id, asset.id));

      posted++;
    }
  });

  revalidatePath("/erp/accounting/assets");
  return { ok: true, count: posted };
}

/* ── Dispose asset ─────────────────────────────────────────── */
export async function disposeAssetAction(input: {
  id: string;
  disposalDate: string;
  disposalProceeds?: number;
  notes?: string;
}): Promise<ActionState> {
  const { orgId } = await requireErpModule("accounting.create");

  const [asset] = await db
    .select()
    .from(fixedAssets)
    .where(and(eq(fixedAssets.id, input.id), eq(fixedAssets.organizationId, orgId)));
  if (!asset) return { error: "الأصل غير موجود" };
  if (asset.status === "DISPOSED") return { error: "تم التخلّص من هذا الأصل مسبقًا" };

  await db.update(fixedAssets).set({
    status: "DISPOSED",
    disposalDate: new Date(input.disposalDate),
    disposalProceeds: input.disposalProceeds ? String(input.disposalProceeds) : null,
    notes: input.notes?.trim() || asset.notes,
    updatedAt: new Date(),
  }).where(eq(fixedAssets.id, input.id));

  revalidatePath("/erp/accounting/assets");
  revalidatePath(`/erp/accounting/assets/${input.id}`);
  return { ok: true };
}
