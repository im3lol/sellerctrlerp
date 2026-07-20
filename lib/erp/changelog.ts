import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { changelogEntries } from "@/db/schema";
import { CHANGELOG_KINDS, KIND_LABELS, type ChangelogKind } from "./changelog-kinds";

/**
 * «آخر التحديثات» — release notes, written at /admin/changelog.
 *
 * Not org-scoped: a release note is about SellerCtrl, not about one tenant's data.
 * Same reasoning as the academy — see the note on the changelog_entries table.
 *
 * Server-only: it imports the db. Client components take the constants from
 * ./changelog-kinds instead.
 */
export { CHANGELOG_KINDS, KIND_LABELS, type ChangelogKind };

export type ChangelogEntry = {
  id: string;
  title: string;
  body: string;
  kind: ChangelogKind;
  module: string | null;
  releasedAt: Date;
  isPublished: boolean;
};

const row = (r: typeof changelogEntries.$inferSelect): ChangelogEntry => ({
  id: r.id,
  title: r.title,
  body: r.body,
  kind: (CHANGELOG_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ChangelogKind) : "feature",
  module: r.module,
  releasedAt: r.releasedAt,
  isPublished: r.isPublished,
});

/** What tenants see — published only, newest first. */
export async function listChangelog(): Promise<ChangelogEntry[]> {
  const rows = await db.select().from(changelogEntries)
    .where(eq(changelogEntries.isPublished, true))
    .orderBy(desc(changelogEntries.releasedAt));
  return rows.map(row);
}

/** Everything including drafts — the admin list. */
export async function listChangelogForAdmin(): Promise<ChangelogEntry[]> {
  const rows = await db.select().from(changelogEntries).orderBy(desc(changelogEntries.releasedAt));
  return rows.map(row);
}
