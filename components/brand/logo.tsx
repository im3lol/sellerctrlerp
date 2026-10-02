import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Use a text-size utility (for example `text-2xl`) to set the logo height. */
  className?: string;
  /** The supplied navy/blue artwork needs a light surface when placed on the blue shell. */
  surface?: "none" | "light";
};

// The original artwork is intentionally preserved untouched. Its visible drawing starts
// at (131, 180) and is 1905 × 404 px inside the 2172 × 724 px transparent canvas.
// These values crop only the transparent surround at render time, so every placement
// gets the exact same proportions without introducing another exported version.
const artworkStyle = {
  height: "1.792em",
  width: "5.376em",
  maxWidth: "none",
  transform: "translate(-0.324em, -0.446em)",
} as const;

/** The approved SellerCtrl logo artwork, kept proportionally consistent across the product. */
export function Logo({ className, surface = "none" }: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        surface === "light" && "rounded-xl bg-white px-2.5 py-2 shadow-sm shadow-black/10",
      )}
    >
      <span dir="ltr" className={cn("relative block h-[1em] w-[4.715em] overflow-hidden", className)}>
        <Image
          src="/brand/sellerctrl-3d-blue-logo.png"
          alt="SellerCtrl"
          width={2172}
          height={724}
          sizes="(max-width: 640px) 96px, 160px"
          className="absolute start-0 top-0"
          style={artworkStyle}
        />
      </span>
    </span>
  );
}

/** The approved 3D icon extracted from the left side of the same supplied artwork. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cn("relative block h-[1em] w-[1.329em] shrink-0 overflow-hidden", className)}>
      <Image
        src="/brand/sellerctrl-3d-blue-logo.png"
        alt=""
        width={2172}
        height={724}
        sizes="48px"
        className="absolute start-0 top-0"
        style={artworkStyle}
      />
    </span>
  );
}
