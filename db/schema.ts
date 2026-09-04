import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  date,
  jsonb,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ───────────────────────── Enums ───────────────────────── */

export const userRoleEnum = pgEnum("user_role", [
  "system_admin", // مدير النظام
  "org_admin", // مدير/صاحب المؤسسة (عميل SaaS)
  "ops_manager", // مدير العمليات
  "team_lead", // قائد فريق
  "employee", // موظف
  "client", // عميل (سابقاً)
]);

/* ───────────────────────── Users ───────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    // Optional login alias — migrated ERP users sign in by username (no email).
    username: varchar("username", { length: 255 }),
    passwordHash: text("password_hash").notNull(),
    // Set whenever the password changes — drives 365-day rotation enforcement.
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    // TOTP two-factor auth. secret is AES-256-GCM encrypted at rest; backup codes
    // are stored as bcrypt hashes (one-time use).
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    mfaBackupCodes: jsonb("mfa_backup_codes").$type<string[]>(),
    role: userRoleEnum("role").notNull().default("employee"),
    avatarUrl: text("avatar_url"),
    title: text("title"), // المسمى الوظيفي
    // User dismissed the onboarding tour for good (server-side so it survives
    // localStorage resets — e.g. a changed tunnel origin).
    tourDismissed: boolean("tour_dismissed").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    // Login brute-force lockout: consecutive failed attempts; account frozen until
    // lockedUntil. Both cleared on a successful sign-in. (Audit#15)
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    hiredAt: timestamp("hired_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_username_idx").on(t.username),
  ],
);

// Recent password hashes per user, to block reuse of the last few passwords.
export const passwordHistory = pgTable(
  "password_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_history_user_idx").on(t.userId)],
);

/* ───────── Attendance (ERP HR — feeds hourly payroll) ───────── */

/**
 * One employee's working day. Keyed by (organization, user, date): a person who works
 * for two companies on this platform has two separate clock streams, and each payroll
 * counts only its own — one global stream would let both runs pay for the same hours.
 *
 * `organizationId` is nullable only so the column could be added to databases that
 * already held rows; every write path sets it, and a row without one is invisible to
 * RLS (fail-closed), which is the right fate for an orphan.
 */
export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id"),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    /** MANUAL (typed by HR) · CLOCK (the employee's own check-in) · IMPORT (device file). */
    source: text("source").notNull().default("MANUAL"),
    notes: text("notes"),
    clockIn: timestamp("clock_in", { withTimezone: true }).notNull().defaultNow(),
    clockOut: timestamp("clock_out", { withTimezone: true }),
    breaks: jsonb("breaks").$type<{ start: string; end: string | null }[]>().default([]),
    totalSeconds: integer("total_seconds").notNull().default(0),
    breakSeconds: integer("break_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attendance_user_date_idx").on(t.userId, t.workDate),
    // One row per person per day per company — a second clock-in edits the same day
    // rather than creating a parallel one payroll would then double-count.
    uniqueIndex("attendance_org_user_date_idx").on(t.organizationId, t.userId, t.workDate),
  ],
);

export * from "./erp";
