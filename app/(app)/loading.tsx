import { PageSkeleton } from "@/components/erp/skeletons";

// Global fallback for every (app) route — a structured page skeleton instead of a
// bare spinner. Route-specific loading.tsx (dashboard, admin) override this.
export default function Loading() {
  return <PageSkeleton />;
}
