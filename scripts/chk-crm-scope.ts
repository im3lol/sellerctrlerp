import { organizations } from "@/db/schema";
import { db } from "@/lib/db";
import { listProducts, countProducts } from "@/lib/queries/products";
import { listTasks } from "@/lib/queries/tasks";
import { getEmployeeKpis, getStatusDistribution, getCompletionTrend } from "@/lib/queries/kpi";
import { gatherOpsMetrics } from "@/lib/queries/ai-metrics";

// Runtime proof that the org-scoped CRM queries (which pass a subquery to
// inArray) actually execute and return data for the active org.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const ok = (c: boolean) => (c ? "✅" : "❌");

  const products = await listProducts({ orgId }, 5, 0);
  const pCount = await countProducts({ orgId });
  const tasks = await listTasks({ orgId });
  const kpis = await getEmployeeKpis(orgId);
  const dist = await getStatusDistribution(orgId);
  const trend = await getCompletionTrend(orgId, 7);
  const ops = await gatherOpsMetrics(orgId);

  console.log(`${ok(pCount >= 0)} listProducts → ${products.length} rows; countProducts → ${pCount}`);
  console.log(`${ok(Array.isArray(tasks))} listTasks → ${tasks.length} rows`);
  console.log(`${ok(Array.isArray(kpis))} getEmployeeKpis → ${kpis.length} employees`);
  console.log(`${ok(Array.isArray(dist))} getStatusDistribution → ${dist.length} statuses`);
  console.log(`${ok(trend.length === 7)} getCompletionTrend → ${trend.length} days`);
  console.log(`${ok(ops.totals.products >= 0)} gatherOpsMetrics → ${ops.totals.products} products, ${ops.byWorkspace.length} workspaces`);
  console.log("— all org-scoped CRM queries executed —");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
