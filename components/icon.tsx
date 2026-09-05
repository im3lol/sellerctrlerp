import { icons, type LucideProps } from "lucide-react";

// lucide v1 renamed several icons; the `icons` lookup only has the new keys.
// Map the legacy names we use so string-based <Icon name="..."> keeps working.
const ALIASES: Record<string, string> = {
  CheckCircle2: "CircleCheck",
  CheckCircle: "CircleCheck",
  AlertTriangle: "TriangleAlert",
  AlertCircle: "CircleAlert",
  XCircle: "CircleX",
  BarChart3: "ChartColumn",
  BarChart: "ChartColumn",
  BarChart2: "ChartColumn",
  LineChart: "ChartLine",
  PieChart: "ChartPie",
  MoreVertical: "EllipsisVertical",
  Edit: "SquarePen",
  Filter: "Funnel",
  Loader2: "LoaderCircle",
  PlayCircle: "CirclePlay",
  FileWarning: "FileExclamationPoint",
};

/** Render a lucide icon by its name (e.g. "LayoutDashboard"). */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const key = (ALIASES[name] ?? name) as keyof typeof icons;
  const LucideIcon = icons[key];
  if (!LucideIcon) return null;
  return <LucideIcon {...props} />;
}
