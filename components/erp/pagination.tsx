import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

const num = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

/**
 * Shared list pagination bar (20/page convention). Pass the current filter
 * params so page links preserve them. Renders just the count line when there is
 * a single page.
 */
export function Pagination({
  page,
  pages,
  total,
  unit,
  basePath,
  params = {},
}: {
  page: number;
  pages: number;
  total: number;
  unit: string;
  basePath: string;
  params?: Record<string, string | number | undefined>;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };

  if (pages <= 1) {
    return <div className="mt-4 text-sm text-muted-foreground">{num(total)} {unit}</div>;
  }

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>صفحة {num(page)} من {num(pages)} · {num(total)} {unit}</span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
          <Link href={href(page - 1)}><Icon name="ChevronRight" className="size-4" />السابق</Link>
        </Button>
        <Button asChild variant="outline" size="sm" disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
          <Link href={href(page + 1)}>التالي<Icon name="ChevronLeft" className="size-4" /></Link>
        </Button>
      </div>
    </div>
  );
}
