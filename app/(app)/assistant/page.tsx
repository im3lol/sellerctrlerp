import { requireCapability } from "@/lib/session";
import { aiConfigured } from "@/lib/ai";
import { PageHeader } from "@/components/page-header";
import { AssistantPanel } from "@/components/ai/assistant-panel";

export default async function AssistantPage() {
  await requireCapability("ai.use");
  return (
    <div>
      <PageHeader title="المساعد الذكي" description="تحليل الأداء واقتراح تحسينات العمليات" />
      <AssistantPanel configured={aiConfigured()} />
    </div>
  );
}
