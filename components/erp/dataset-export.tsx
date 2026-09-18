import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** Excel + print for a page's EXPORT_DATASETS entry (lib/erp/export-datasets.ts). */
export function DatasetExport({ dataset }: { dataset: string }) {
  return (
    <div className="flex gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={`/api/erp/exports/${dataset}`}><Icon name="FileSpreadsheet" className="size-4" />Excel</a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={`/exports/${dataset}`} target="_blank" rel="noopener"><Icon name="Printer" className="size-4" />طباعة</a>
      </Button>
    </div>
  );
}
