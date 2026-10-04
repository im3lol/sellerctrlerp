"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";

export function ItemSalesFilters({ from, to, q }: { from: string; to: string; q: string }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState(from);
  const [toDate, setToDate] = useState(to);
  const [search, setSearch] = useState(q);

  const apply = () => {
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (toDate) p.set("to", toDate);
    if (search) p.set("q", search);
    router.push(`?${p.toString()}`);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">{t("من")}</Label>
            <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="w-36 h-8 text-sm" dir="ltr" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("إلى")}</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-36 h-8 text-sm" dir="ltr" />
          </div>
          <div className="space-y-1 flex-1 min-w-40">
            <Label className="text-xs">{t("بحث بالصنف")}</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("كود أو اسم...")} className="h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && apply()} />
          </div>
          <Button size="sm" onClick={apply} className="h-8">
            <Icon name="Search" className="size-4" />{t("تطبيق")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
