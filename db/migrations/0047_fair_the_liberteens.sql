CREATE TABLE "academy_lessons" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"module" text NOT NULL,
	"outcome" text,
	"url" text,
	"minutes" integer,
	"level" text DEFAULT 'basic' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_lessons_slug_idx" ON "academy_lessons" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "academy_lessons_module_idx" ON "academy_lessons" USING btree ("module","sort_order");