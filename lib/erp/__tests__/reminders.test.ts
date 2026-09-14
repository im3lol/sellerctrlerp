import { describe, it, expect } from "vitest";
import { parseReminderPolicy, reminderDue, DEFAULT_REMINDER_STAGES } from "@/lib/erp/reminders";

describe("the reminder setting", () => {
  it("is off, on the default stages, until someone sets it", () => {
    expect(parseReminderPolicy(null)).toEqual({ enabled: false, stages: DEFAULT_REMINDER_STAGES });
    expect(parseReminderPolicy({ stuck: { so: 3 } })).toEqual({ enabled: false, stages: DEFAULT_REMINDER_STAGES });
  });

  it("keeps sane stages, sorted, once", () => {
    expect(parseReminderPolicy({ reminders: { enabled: true, stages: [20, "5", 5, -1, 400, 1.5] } }))
      .toEqual({ enabled: true, stages: [5, 20] });
  });
});

describe("which reminder is due", () => {
  const S = [3, 10, 20];

  it("sends nothing before the first stage", () => {
    expect(reminderDue(2, S, 0)).toBeNull();
  });

  it("sends each stage once", () => {
    expect(reminderDue(3, S, 0)).toBe(3);
    expect(reminderDue(4, S, 3)).toBeNull();
    expect(reminderDue(10, S, 3)).toBe(10);
  });

  it("after a missed run sends only the latest stage, not all of them", () => {
    expect(reminderDue(25, S, 0)).toBe(20);
    expect(reminderDue(25, S, 20)).toBeNull();
  });
});
