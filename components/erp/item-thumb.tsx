import { Image as ImageIcon } from "lucide-react";

/**
 * The item picture as it appears in every document line table — the purchase-order form's
 * own column and the saved order / invoice / goods-receipt views.
 *
 * Deliberately NOT a client component. It has no state, and the saved-document pages are
 * server components: keeping it here means they render the picture server-side instead of
 * pulling the item picker (its portal, effects and search action) into the browser bundle
 * for a static image.
 *
 * object-contain in a fixed box, with a placeholder when the item has no image, so rows
 * never jump in height between the two cases.
 */
export function ItemThumb({ src, className = "size-9" }: { src?: string | null; className?: string }) {
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-md border bg-muted/40`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-contain" loading="lazy" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground"><ImageIcon className="size-4" /></div>
      )}
    </div>
  );
}
