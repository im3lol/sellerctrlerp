import { requireUser } from "@/lib/session";
import { ROLE_LABELS_AR, type Role } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/profile/profile-form";
import Link from "next/link";
import { Icon } from "@/components/icon";

export default async function ProfilePage() {
  const user = await requireUser();
  const init = user.name.split(" ").slice(0, 2).map((p) => p[0]).join("");

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

          {/* The employee's own HR corner. Shown to everyone: the page itself decides
              whether this user has an employee record, and says so if not. */}
          <Link
            href="/profile/hr"
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Icon name="IdCard" className="size-4" />
            ملفي الوظيفي — راتبي وإجازاتي
          </Link>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-4 font-semibold">تعديل البيانات</h2>
          <ProfileForm name={user.name} email={user.email} />
        </Card>
      </div>
    </div>
  );
}
