"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";

export function ItemSalesFilters({ from, to, q }: { from: string; to: string; q: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [search, setSearch] = useState(q);

  const apply = () => {
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    if (search) p.set("q", search);
    router.push(`?${p.toString()}`);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">من</Label>
            <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="w-36 h-8 text-sm" dir="ltr" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={t} onChange={(e) => setT(e.target.value)} className="w-36 h-8 text-sm" dir="ltr" />
          </div>
          <div className="space-y-1 flex-1 min-w-40">
            <Label className="text-xs">بحث بالصنف</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="كود أو اسم..." className="h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && apply()} />
          </div>
          <Button size="sm" onClick={apply} className="h-8">
            <Icon name="Search" className="size-4" />تطبيق
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
