import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AccountSecurity } from "@/components/erp/account-security";

export default async function SecurityPage() {
  const sessionUser = await requireUser();
  const [u] = await db.select({ mfaEnabled: users.mfaEnabled, passwordChangedAt: users.passwordChangedAt })
    .from(users).where(eq(users.id, sessionUser.id)).limit(1);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ErpPageHeader icon="ShieldCheck" title="الأمان وكلمة المرور" subtitle="غيّر كلمة مرورك وفعّل المصادقة الثنائية" backHref="/settings" />
      <AccountSecurity mfaEnabled={!!u?.mfaEnabled} passwordChangedAt={u?.passwordChangedAt ? new Date(u.passwordChangedAt).toISOString() : null} />
    </div>
  );
}
