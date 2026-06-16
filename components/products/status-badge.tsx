export function StatusBadge({
  name,
  color,
}: {
  name: string | null;
  color: string | null;
}) {
  if (!name) return <span className="text-xs text-muted-foreground">—</span>;
  const c = color ?? "#94a3b8";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: `${c}1a`, color: c }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: c }} />
      {name}
    </span>
  );
}
