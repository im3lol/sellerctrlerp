import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Logo className="text-4xl text-primary-foreground" />
        <div className="space-y-4">
          <h2 className="text-3xl font-bold leading-tight">
            تحكم كامل في عملياتك من مكان واحد
          </h2>
          <p className="text-primary-foreground/80">
            نظام داخلي لإدارة الموظفين والعملاء والمنتجات والمهام وتوزيع العمل
            ومراقبة الأداء.
          </p>
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
          <div className="mt-6 flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <a href="/login" className="hover:text-foreground">الفريق</a>
            <span>·</span>
            <a href="/login/admin" className="hover:text-foreground">الإدارة</a>
            <span>·</span>
            <a href="/login/client" className="hover:text-foreground">الشركاء</a>
          </div>
        </div>
      </div>
    </div>
  );
}
