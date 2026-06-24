import { redirect } from "next/navigation";

// The system has ONE unified dashboard at /dashboard (ERP overview + ops in a
// single board). This route is kept only to redirect old links there.
export default function ErpDashboardRedirect() {
  redirect("/dashboard");
}
