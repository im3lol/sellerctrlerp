"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LogIn, SlidersHorizontal, Wallet } from "lucide-react";
import { impersonateTenantAction } from "@/app/actions/admin/impersonate";
import { Button } from "@/components/ui/button";

/** Quick actions on the tenant profile: enter-for-support, edit licensing, record a payment. */
export function TenantActions({ orgId }: { orgId: string }) {
  const [pending, start] = useTransition();
  const support = () => start(async () => {
    const r = await impersonateTenantAction(orgId); // redirects on success
    if (r && "error" in r) toast.error(r.error);
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={support} disabled={pending}><LogIn className="size-4" />دخول للدعم</Button>
      <Button size="sm" variant="outline" asChild><Link href="/admin/licensing"><SlidersHorizontal className="size-4" />تعديل الاشتراك</Link></Button>
      <Button size="sm" variant="outline" asChild><Link href="/admin/collections"><Wallet className="size-4" />تسجيل تحصيل</Link></Button>
    </div>
  );
}
