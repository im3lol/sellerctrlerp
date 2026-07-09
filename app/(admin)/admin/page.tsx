import Link from "next/link";
import { Icon } from "@/components/icon";

const SECTIONS = [
  { label: "المستخدمون", desc: "إنشاء مستخدمي النظام وتعيين أدوارهم وربطهم بالمؤسسات.", href: "/admin/users", icon: "Users" },
  { label: "التراخيص والتفعيل", desc: "اشتراك كل مؤسسة، الوحدات المفعّلة، وتاريخ الانتهاء.", href: "/admin/licensing", icon: "KeyRound" },
] as const;

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">لوحة الإدارة</h1>
        <p className="text-muted-foreground">إدارة النظام — منفصلة عن الاستخدام اليومي للـ ERP.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary hover:bg-accent">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"><Icon name={s.icon} className="size-5" /></div>
            <div><div className="font-semibold">{s.label}</div><div className="text-xs text-muted-foreground">{s.desc}</div></div>
          </Link>
        ))}
      </div>
    </div>
  );
}
