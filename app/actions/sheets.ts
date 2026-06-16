"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sheetsConnections } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { readHeaders } from "@/lib/sheets";
import { syncConnection, type SyncResult } from "@/lib/sync";

export async function previewHeadersAction(
  spreadsheetId: string,
  sheetName: string,
  headerRow: number,
): Promise<{ ok: boolean; headers?: string[]; error?: string }> {
  await requireCapability("sheets.connect");
  try {
    const headers = await readHeaders(spreadsheetId.trim(), sheetName.trim() || "Sheet1", headerRow || 1);
    return { ok: true, headers };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذّر قراءة الورقة" };
  }
}

export async function createSheetConnectionAction(input: {
  workspaceId: string;
  spreadsheetId: string;
  sheetName: string;
  headerRow: number;
  columnMap: Record<string, string>;
  autoSync: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireCapability("sheets.connect");
  if (!input.workspaceId || !input.spreadsheetId) return { ok: false, error: "بيانات ناقصة" };
  if (!input.columnMap.sku) return { ok: false, error: "يجب تعيين عمود SKU" };

  const [conn] = await db
    .insert(sheetsConnections)
    .values({
      workspaceId: input.workspaceId,
      spreadsheetId: input.spreadsheetId.trim(),
      sheetName: input.sheetName.trim() || "Sheet1",
      headerRow: input.headerRow || 1,
      columnMap: input.columnMap,
      autoSync: input.autoSync,
    })
    .returning();

  revalidatePath("/admin/sheets");
  return { ok: true, id: conn.id };
}

export async function syncNowAction(connectionId: string): Promise<SyncResult> {
  await requireCapability("sheets.connect");
  const result = await syncConnection(connectionId);
  revalidatePath("/admin/sheets");
  return result;
}

export async function deleteSheetConnectionAction(id: string) {
  await requireCapability("sheets.connect");
  await db.delete(sheetsConnections).where(eq(sheetsConnections.id, id));
  revalidatePath("/admin/sheets");
}
