import Link from "next/link";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/reports",                  label: "ميزان المراجعة",       icon: "ChartPie"       },
  { href: "/reports/income-statement", label: "قائمة الدخل",          icon: "TrendingUp"     },
  { href: "/reports/balance-sheet",    label: "الميزانية العمومية",   icon: "Scale"          },
  { href: "/reports/cash-flow",        label: "التدفق النقدي",        icon: "ArrowLeftRight" },
  { href: "/reports/vat",              label: "ضريبة القيمة المضافة", icon: "Percent"        },
];

/** Quick switcher between the financial statements. */
export function ReportTabs({ active }: { active: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon name={t.icon} className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
