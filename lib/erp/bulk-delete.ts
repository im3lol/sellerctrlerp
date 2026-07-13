// Shared bulk-delete: runs an entity's existing single-delete action per id so
// all its guards apply (a referenced/posted record is rejected → counted as
// "blocked" instead of failing the whole batch). Tally deleted vs blocked.

export type BulkResult = { ok: true; deleted: number; blocked: number } | { ok: false; error: string };

export async function bulkRun(
  ids: string[],
  deleteOne: (id: string) => Promise<{ ok?: boolean; error?: string }>,
): Promise<BulkResult> {
  if (!ids?.length) return { ok: false, error: "لم تحدّد أي عنصر" };
  let deleted = 0, blocked = 0;
  for (const id of ids) {
    try {
      const r = await deleteOne(id);
      if (r?.ok) deleted++; else blocked++;
    } catch { blocked++; }
  }
  return { ok: true, deleted, blocked };
}

// Op-based bulk result for documents supporting more than delete (confirm/post/
// cancel/approve…). Reuses the entity's existing single-item action per id so
// every guard/precondition applies; ineligible rows are silently skipped.
export type BulkOpResult = { ok: true; count: number } | { ok: false; error: string };

export async function bulkOp(
  ids: string[],
  runOne: (id: string) => Promise<{ ok?: boolean; error?: string }>,
): Promise<BulkOpResult> {
  if (!ids?.length) return { ok: false, error: "لم تحدّد أي عنصر" };
  let count = 0;
  for (const id of ids) {
    try { if ((await runOne(id))?.ok) count++; } catch { /* skip */ }
  }
  return { ok: true, count };
}
