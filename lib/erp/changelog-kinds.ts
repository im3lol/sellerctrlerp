/**
 * Changelog constants — no DB imports, safe to use in client components.
 *
 * Separate from changelog.ts on purpose: that file queries the database, so importing
 * it from a client component drags `pg` into the browser bundle and the build fails
 * on `Can't resolve 'dns'`. Same split as module-list.ts.
 */
export const CHANGELOG_KINDS = ["feature", "improvement", "fix"] as const;
export type ChangelogKind = (typeof CHANGELOG_KINDS)[number];

export const KIND_LABELS: Record<string, string> = {
  feature: "جديد",
  improvement: "تحسين",
  fix: "إصلاح",
};
