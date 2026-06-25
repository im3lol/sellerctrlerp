import { Lock, AlertTriangle, Phone } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export function LicenseLocked() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background p-6" dir="rtl">
      <Logo className="text-3xl text-muted-foreground" />

      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <Lock className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-bold">انتهى ترخيص النظام</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          لم يتمكّن النظام من التحقّق من الترخيص. يرجى التواصل مع موفّر النظام لتجديد الاشتراك وإعادة التشغيل.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Phone className="h-4 w-4 shrink-0" />
        <span>للدعم والتجديد: تواصل مع مزوّد النظام</span>
      </div>
    </div>
  );
}

export function LicenseGraceBanner({ daysLeft }: { daysLeft: number }) {
  return (
    <div className="flex items-center gap-3 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" dir="rtl">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        <strong>تحذير:</strong> لم يتمكّن النظام من التواصل مع خادم الترخيص.
        {" "}متبقّي <strong>{daysLeft} {daysLeft === 1 ? "يوم" : "أيام"}</strong> قبل التوقّف.
        يرجى التحقّق من الاتصال بالإنترنت أو التواصل مع المورّد.
      </span>
    </div>
  );
}
