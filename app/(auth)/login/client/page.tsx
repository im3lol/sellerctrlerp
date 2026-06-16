import { redirect } from "next/navigation";

// Old partner URL — kept as a redirect so existing links keep working.
export default function ClientLoginRedirect() {
  redirect("/login/partner");
}
