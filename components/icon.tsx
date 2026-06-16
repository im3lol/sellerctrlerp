import { icons, type LucideProps } from "lucide-react";

/** Render a lucide icon by its name (e.g. "LayoutDashboard"). */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const LucideIcon = icons[name as keyof typeof icons];
  if (!LucideIcon) return null;
  return <LucideIcon {...props} />;
}
