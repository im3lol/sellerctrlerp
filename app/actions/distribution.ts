"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/session";
import { distributeWorkspace, type Strategy, type DistributionResult } from "@/lib/distribution";

export async function runDistributionAction(
  workspaceId: string,
  strategy: Strategy,
): Promise<DistributionResult> {
  const user = await requireCapability("product.distribute");
  const result = await distributeWorkspace(workspaceId, strategy, user.id);
  revalidatePath(`/workspaces/${workspaceId}`);
  revalidatePath("/admin/distribution");
  revalidatePath("/products");
  return result;
}
