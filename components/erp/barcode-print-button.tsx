"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export type BarcodeItem = {
  barcode: string;
  itemCode: string;
  itemName: string;
  quantity: number;
};

/** Opens the browser barcode-print page (50×25mm labels → print / PDF). */
export function BarcodePrintButton({
  items,
  printPageHref,
}: {
  items: BarcodeItem[];
  printPageHref?: string;
}) {
  const printable = items.filter((i) => i.barcode);
  if (!printPageHref || (printable.length === 0 && !printPageHref)) return null;

  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={printPageHref} target="_blank">
        <Icon name="Tag" className="size-4" />طباعة باركود
      </Link>
    </Button>
  );
}
