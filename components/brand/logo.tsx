import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Use a text-size utility (for example `text-2xl`) to set the logo height. */
  className?: string;
  /** Use the supplied white wordmark on blue brand surfaces. */
  variant?: "blue" | "white";
};

// Both approved PNGs retain their original transparent canvases. The dimensions below
// clip only transparent surround at render time, preserving the supplied source files
// while keeping the visual mark at one consistent height across the product.
const artwork = {
  blue: {
    src: "/brand/sellerctrl-3d-blue-logo.png",
    width: "4.715em",
    style: { height: "1.792em", width: "5.376em", maxWidth: "none", transform: "translate(-0.324em, -0.446em)" },
  },
  white: {
    src: "/brand/sellerctrl-logo-white.png",
    width: "4.655em",
    style: { height: "1.920em", width: "5.761em", maxWidth: "none", transform: "translate(-0.538em, -0.469em)" },
  },
} as const;

/** The approved SellerCtrl logo artwork, kept proportionally consistent across the product. */
export function Logo({ className, variant = "blue" }: LogoProps) {
  const current = artwork[variant];
  return (
    <span className="inline-flex shrink-0 items-center justify-center">
      <span dir="ltr" className={cn("relative block h-[1em] overflow-hidden", className)} style={{ width: current.width }}>
        <Image
          src={current.src}
          alt="SellerCtrl"
          width={2172}
          height={724}
          sizes="(max-width: 640px) 96px, 160px"
          className="absolute start-0 top-0"
          style={current.style}
        />
      </span>
    </span>
  );
}

/** The approved 3D icon extracted from the left side of the same supplied artwork. */
export function LogoMark({ className, variant = "blue" }: { className?: string; variant?: "blue" | "white" }) {
  const current = artwork[variant];
  return (
    <span dir="ltr" className={cn("relative block h-[1em] w-[1.329em] shrink-0 overflow-hidden", className)}>
      <Image
        src={current.src}
        alt=""
        width={2172}
        height={724}
        sizes="48px"
        className="absolute start-0 top-0"
        style={current.style}
      />
    </span>
  );
}
