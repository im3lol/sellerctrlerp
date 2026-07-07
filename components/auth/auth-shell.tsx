import { Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/**
 * Two-column auth screen. The left brand panel content is provided per page so
 * each audience (team / admin / partner) sees tailored messaging.
 */
export function AuthShell({
  heading,
  text,
  points,
  children,
}: {
  heading: string;
  text: string;
  points?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Logo className="text-4xl text-primary-foreground" />
        <div className="space-y-5">
          <h2 className="text-3xl font-bold leading-tight">{heading}</h2>
          <p className="text-primary-foreground/80">{text}</p>
          {points && points.length > 0 && (
            <ul className="space-y-3 pt-2">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <span className="text-primary-foreground/90">{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-sm text-primary-foreground/60">
          © {new Date().getFullYear()} SellerCtrl. جميع الحقوق محفوظة.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo className="text-4xl text-primary" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
