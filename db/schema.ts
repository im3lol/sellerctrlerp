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
    role: userRoleEnum("role").notNull().default("employee"),
    avatarUrl: text("avatar_url"),
    title: text("title"), // المسمى الوظيفي
    isActive: boolean("is_active").notNull().default(true),
    hiredAt: timestamp("hired_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_username_idx").on(t.username),
  ],
);

/* ───────── Attendance (ERP HR — feeds hourly payroll) ───────── */

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
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
  ],
);

export * from "./erp";
