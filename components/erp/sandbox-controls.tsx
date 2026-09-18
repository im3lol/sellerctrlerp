"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSandboxAction, deleteSandboxAction } from "@/app/actions/erp/sandbox";
import { setActiveOrgAction } from "@/app/actions/org";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** «جرّب بشركة تجريبية» — builds (or reopens) the demo company and switches to it. */
export function SandboxStartButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    const r = await createSandboxAction();
    if (!r.ok) { toast.error(r.error); return; }
    router.push("/dashboard");
    router.refresh();
  });
  return (
    <Button variant={variant} disabled={pending} onClick={go}
      title="شركة منفصلة فيها بيانات أمازون وهمية — شركتك الحقيقية مش بتتلمس">
      <Icon name={pending ? "LoaderCircle" : "FlaskConical"} className={`size-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "بنجهّز الشركة التجريبية… حوالي دقيقة" : "جرّب بشركة تجريبية"}
    </Button>
  );
}

/** Strip shown on every page while the demo company is the active one. */
export function SandboxBanner({ realOrgId }: { realOrgId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const back = () => start(async () => {
    if (realOrgId) await setActiveOrgAction(realOrgId);
    router.push(realOrgId ? "/dashboard" : "/apps");
    router.refresh();
  });
  const remove = () => {
    if (!confirm("هتمسح الشركة التجريبية وكل بياناتها الوهمية. شركتك الحقيقية مش هتتأثر. تكمل؟")) return;
    start(async () => {
      const r = await deleteSandboxAction();
      if (!r.ok) { toast.error(r.error); return; }
      toast.success("اتمسحت الشركة التجريبية");
      router.push("/apps");
      router.refresh();
    });
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm md:px-6">
      <span className="flex items-center gap-2 font-medium text-sky-800 dark:text-sky-300">
        <Icon name="FlaskConical" className="size-4" />
        انت في الشركة التجريبية — كل البيانات هنا وهمية، جرّب براحتك
      </span>
      <div className="flex gap-2">
        {realOrgId && (
          <Button size="sm" variant="outline" disabled={pending} onClick={back}>ارجع لشركتي</Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={remove}>
          <Icon name="Trash2" className="size-4" />امسح الشركة التجريبية
        </Button>
      </div>
    </div>
  );
}
