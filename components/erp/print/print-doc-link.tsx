import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/**
 * «طباعة» on a document's detail page — opens its print view in a new tab.
 *
 * A plain link, so it works from a server component. The print page itself carries the
 * client-side print trigger (PrintNowButton).
 */
export function PrintDocLink({ href }: { href: string }) {
  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={href} target="_blank" rel="noopener">
        <Icon name="Printer" className="size-4" />طباعة
      </Link>
    </Button>
  );
}
