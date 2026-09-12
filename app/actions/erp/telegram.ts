"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";

/** Stop approval messages to this member's Telegram — their own membership only. */
export async function unlinkTelegramAction(): Promise<void> {
  const { user, org } = await getActiveOrg();
  if (!org || !user) return;
  await withOrgScope(org.id, false, () => db.update(organizationMembers).set({ telegramChatId: null })
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, user.id))));
  revalidatePath("/profile");
}
