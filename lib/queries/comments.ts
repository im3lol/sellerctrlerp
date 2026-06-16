import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, users } from "@/db/schema";

export type EntityType = "product" | "task" | "workspace";

export async function listComments(entityType: EntityType, entityId: string) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorName: users.name,
      authorAvatar: users.avatarUrl,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)))
    .orderBy(asc(comments.createdAt));
}

export type CommentRow = Awaited<ReturnType<typeof listComments>>[number];
