import type { OpsMetrics } from "@/lib/queries/ai-metrics";

export type OpsAnalysis = {
  source: "ai" | "heuristic";
  summary: string;
  bottlenecks: { title: string; detail: string }[];
  strugglingEmployees: { name: string; reason: string }[];
  recommendations: string[];
};

const MODEL = process.env.AI_MODEL ?? "claude-sonnet-4-6";

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * AI Operations Assistant (§24). Sends aggregated metrics to Claude and returns
 * Arabic recommendations. Falls back to a deterministic heuristic when no API
 * key is configured, so the feature is always useful.
 */
export async function analyzeOps(metrics: OpsMetrics): Promise<OpsAnalysis> {
  if (!aiConfigured()) return heuristicAnalysis(metrics);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system =
    "أنت مساعد عمليات ذكي لشركة SellerCtrl. تحلّل بيانات الأداء وتكتشف الاختناقات والموظفين المتعثرين والمنتجات المتأخرة، ثم تقترح إعادة توزيع العمل. " +
    "أجب بالعربية فقط. أعد ردّك بصيغة JSON صالحة فقط دون أي نص إضافي، بالشكل التالي: " +
    `{"summary": string, "bottlenecks": [{"title": string, "detail": string}], "strugglingEmployees": [{"name": string, "reason": string}], "recommendations": [string]}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [
        {
          role: "user",
          content:
            "حلّل بيانات العمليات التالية واقترح تحسينات عملية ومختصرة:\n\n" +
            JSON.stringify(metrics, null, 2),
        },
      ],
    });

    const text = (response.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    const parsed = extractJson(text);
    if (parsed) {
      return {
        source: "ai",
        summary: String(parsed.summary ?? ""),
        bottlenecks: Array.isArray(parsed.bottlenecks) ? parsed.bottlenecks : [],
        strugglingEmployees: Array.isArray(parsed.strugglingEmployees) ? parsed.strugglingEmployees : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };
    }
  } catch {
    // fall through to heuristic on any API error
  }
  return heuristicAnalysis(metrics);
}

function extractJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Deterministic analysis used when the Claude API isn't configured. */
function heuristicAnalysis(m: OpsMetrics): OpsAnalysis {
  const bottlenecks: { title: string; detail: string }[] = [];
  if (m.totals.unassigned > 0)
    bottlenecks.push({ title: "منتجات غير معيّنة", detail: `${m.totals.unassigned} منتج بانتظار التوزيع على الموظفين.` });
  if (m.totals.late > 0)
    bottlenecks.push({ title: "منتجات متأخرة", detail: `${m.totals.late} منتج مضى على إنشائها أكثر من أسبوع دون إكمال.` });

  const overloaded = m.byWorkspace.filter((w) => w.unassigned > 0);
  for (const w of overloaded.slice(0, 3))
    bottlenecks.push({ title: `مساحة العمل ${w.name}`, detail: `${w.unassigned} منتج غير معيّن.` });

  const avgRate = m.employees.length
    ? Math.round(m.employees.reduce((s, e) => s + e.completionRate, 0) / m.employees.length)
    : 0;
  const struggling = m.employees
    .filter((e) => e.total > 0 && e.completionRate < Math.max(20, avgRate - 20))
    .map((e) => ({ name: e.name, reason: `نسبة إنجاز ${e.completionRate}% أقل من متوسط الفريق (${avgRate}%).` }));

  const recommendations: string[] = [];
  if (m.totals.unassigned > 0) recommendations.push("شغّل محرّك التوزيع لتوزيع المنتجات غير المعيّنة على الموظفين.");
  if (struggling.length) recommendations.push("راجع أحمال العمل وأعد توزيع بعض المنتجات من الموظفين المتعثرين إلى الأعلى إنتاجية.");
  if (m.totals.late > 0) recommendations.push("أعطِ أولوية للمنتجات المتأخرة وحدّد مواعيد نهائية واضحة.");
  if (recommendations.length === 0) recommendations.push("الأداء جيد — استمر في المتابعة الدورية.");

  const completionRate = m.totals.products > 0 ? Math.round((m.totals.completed / m.totals.products) * 100) : 0;

  return {
    source: "heuristic",
    summary: `إجمالي ${m.totals.products} منتج بنسبة إنجاز ${completionRate}%. ${m.totals.unassigned} غير معيّن و${m.totals.late} متأخر.`,
    bottlenecks,
    strugglingEmployees: struggling,
    recommendations,
  };
}
