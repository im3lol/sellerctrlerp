import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";

export type ErpModulePlaceholderProps = {
  /** Lucide icon name (e.g. "Calculator"). */
  icon: string;
  /** Arabic module title. */
  title: string;
  /** One-line Arabic description. */
  description: string;
  /** Planned features shown as a checklist. */
  features?: string[];
};

/**
 * Branded "coming soon" surface for an ERP module that is wired into the
 * SellerCtrl shell/navigation but not yet migrated (see merge plan phases 4–5).
 */
export function ErpModulePlaceholder({ icon, title, description, features = [] }: ErpModulePlaceholderProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon name={icon} className="size-7" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{title}</h1>
            <Badge variant="secondary" className="gap-1">
              <Icon name="Wrench" className="size-3.5" />
              قيد الدمج
            </Badge>
          </div>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>قريباً ضمن SellerCtrl</CardTitle>
          <CardDescription>
            هذه الوحدة مرتبطة بالنظام وستُفعَّل تباعاً خلال مراحل دمج الـ ERP داخل SellerCtrl.
          </CardDescription>
        </CardHeader>
        {features.length > 0 && (
          <CardContent>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Icon name="CircleCheck" className="size-4 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
