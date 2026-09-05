CREATE TABLE "applicant_interviews" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"applicant_id" text NOT NULL,
	"interviewer_id" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"stage" text DEFAULT 'INTERVIEW' NOT NULL,
	"outcome" text,
	"rating" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applicants" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"opening_id" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text,
	"source" text,
	"stage" text DEFAULT 'APPLIED' NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"employee_id" text,
	"rating" integer,
	"expected_salary" numeric(18, 4) DEFAULT '0' NOT NULL,
	"cv_attachment_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_openings" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"title_ar" text NOT NULL,
	"department" text,
	"headcount" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"hiring_manager_id" text,
	"salary_from" numeric(18, 4) DEFAULT '0' NOT NULL,
	"salary_to" numeric(18, 4) DEFAULT '0' NOT NULL,
	"description" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"reviewer_id" text,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"overall_score" numeric(18, 4) DEFAULT '0' NOT NULL,
	"strengths" text,
	"improvements" text,
	"goals" text,
	"acknowledged_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_scores" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"review_id" text NOT NULL,
	"criterion" text NOT NULL,
	"weight" numeric(18, 4) DEFAULT '1' NOT NULL,
	"score" numeric(18, 4) DEFAULT '0' NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"provider" text,
	"starts_at" text,
	"ends_at" text,
	"hours" numeric(18, 4) DEFAULT '0' NOT NULL,
	"cost_per_seat" numeric(18, 4) DEFAULT '0' NOT NULL,
	"seats" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_enrollments" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"course_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"status" text DEFAULT 'ENROLLED' NOT NULL,
	"score" numeric(18, 4),
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applicant_interviews" ADD CONSTRAINT "applicant_interviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_interviews" ADD CONSTRAINT "applicant_interviews_applicant_id_job_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."job_applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_interviews" ADD CONSTRAINT "applicant_interviews_interviewer_id_employees_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_opening_id_job_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_openings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_hiring_manager_id_employees_id_fk" FOREIGN KEY ("hiring_manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_id_employees_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_scores" ADD CONSTRAINT "review_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_scores" ADD CONSTRAINT "review_scores_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_openings_org_code_idx" ON "job_openings" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "training_courses_org_code_idx" ON "training_courses" USING btree ("organization_id","code");--> statement-breakpoint
-- Tenant isolation for the people tables (mirrors db/rls/01-policies.sql, which only
-- runs at cutover). All seven carry organization_id directly.
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_openings', 'job_applicants', 'applicant_interviews',
                           'performance_reviews', 'review_scores',
                           'training_courses', 'training_enrollments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY org_isolation ON %I FOR ALL
        USING (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
        WITH CHECK (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
    $f$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appuser', t);
    END IF;
  END LOOP;
END $rls$;
