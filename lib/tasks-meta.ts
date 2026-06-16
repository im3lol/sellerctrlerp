// Client-safe task metadata (no DB imports — safe to import from client components).

export const TASK_STATUS_AR: Record<string, string> = {
  new: "جديد",
  in_progress: "قيد التنفيذ",
  review: "مراجعة",
  done: "مكتمل",
  blocked: "متوقف",
};

export const TASK_PRIORITY_AR: Record<string, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  urgent: "عاجلة",
};

export const KANBAN_COLUMNS: { key: string; label: string }[] = [
  { key: "new", label: "جديد" },
  { key: "in_progress", label: "قيد التنفيذ" },
  { key: "review", label: "مراجعة" },
  { key: "done", label: "مكتمل" },
];
