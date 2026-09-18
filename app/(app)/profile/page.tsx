import { requireUser } from "@/lib/session";
import { ROLE_LABELS_AR, type Role } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/profile/profile-form";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ClockButton } from "@/components/erp/clock-button";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { telegramEnabled, linkPayload, botUsername } from "@/lib/erp/telegram";
import { unlinkTelegramAction } from "@/app/actions/erp/telegram";

export default async function ProfilePage() {
  const user = await requireUser();
  const init = user.name.split(" ").slice(0, 2).map((p) => p[0]).join("");

  // Telegram: approval requests and decisions reach this member on their phone.
  const { org } = await getActiveOrg();
  const enabled = await telegramEnabled();
  const [member] = org && enabled
    ? await withOrgScope(org.id, false, () => db.select({ id: organizationMembers.id, chatId: organizationMembers.telegramChatId })
        .from(organizationMembers).where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, user.id))).limit(1))
    : [];
  const bot = member && !member.chatId ? await botUsername() : null;
  const telegramLink = member && !member.chatId && bot ? await linkPayload(member.id) : null;

  return (
    <div>
      <PageHeader title="الملف الشخصي" description="إدارة بياناتك الشخصية" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <Avatar className="size-24">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
            <AvatarFallback className="bg-primary/10 text-2xl font-bold text-primary">{init}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-lg font-bold">{user.name}</p>
            <p className="text-sm text-muted-foreground" dir="ltr">{user.email}</p>
          </div>
          <Badge variant="secondary">{ROLE_LABELS_AR[user.role as Role]}</Badge>
          {user.title && <p className="text-sm text-muted-foreground">{user.title}</p>}

          <ClockButton />

          {/* The employee's own HR corner. Shown to everyone: the page itself decides
              whether this user has an employee record, and says so if not. */}
          <Link
            href="/profile/hr"
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Icon name="IdCard" className="size-4" />
            ملفي الوظيفي — راتبي وإجازاتي
          </Link>

          {member?.chatId ? (
            <form action={unlinkTelegramAction} className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><Icon name="Send" className="size-4" />تليجرام مربوط ✓</span>
              <button type="submit" className="text-xs text-muted-foreground hover:text-destructive">فك الربط</button>
            </form>
          ) : member && bot && telegramLink ? (
            <a href={`https://t.me/${bot}?start=${telegramLink}`} target="_blank" rel="noopener noreferrer"
              title="الرابط صالح 15 دقيقة"
              className="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent">
              <Icon name="Send" className="size-4" />
              اربط تليجرام — توصلك الموافقات على موبايلك
            </a>
          ) : null}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-4 font-semibold">تعديل البيانات</h2>
          <ProfileForm name={user.name} email={user.email} />
        </Card>
      </div>
    </div>
  );
}
