"use server";

import { requireCapability } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { gatherOpsMetrics } from "@/lib/queries/ai-metrics";
import { analyzeOps, type OpsAnalysis } from "@/lib/ai";

export async function runOpsAnalysisAction(): Promise<OpsAnalysis> {
  await requireCapability("ai.use");
  const { org } = await getActiveOrg();
  if (!org) throw new Error("لا توجد مؤسسة نشطة");
  const metrics = await gatherOpsMetrics(org.id);
  return analyzeOps(metrics);
}
