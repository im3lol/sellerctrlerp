"use server";

import { requireCapability } from "@/lib/session";
import { gatherOpsMetrics } from "@/lib/queries/ai-metrics";
import { analyzeOps, type OpsAnalysis } from "@/lib/ai";

export async function runOpsAnalysisAction(): Promise<OpsAnalysis> {
  await requireCapability("ai.use");
  const metrics = await gatherOpsMetrics();
  return analyzeOps(metrics);
}
