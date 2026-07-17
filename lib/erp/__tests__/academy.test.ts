import { describe, it, expect } from "vitest";
import { LESSONS, lessonsByModule, lessonsFor, progress } from "../academy";
import { ALL_MODULES, MODULE_LABELS } from "../module-list";

describe("academy catalogue", () => {
  it("every lesson points at a real module", () => {
    // A typo'd module key wouldn't crash — the lesson would just silently vanish
    // from the page and from its module's «اتعلّم» count.
    for (const l of LESSONS) {
      expect(ALL_MODULES, `lesson "${l.id}" has module "${l.module}"`).toContain(l.module);
    }
  });

  it("lesson ids are unique — they're used as anchors", () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups in sidebar order and drops empty modules", () => {
    const groups = lessonsByModule();
    const order = groups.map((g) => g.module);
    // Same relative order as ALL_MODULES, so the page reads like the sidebar.
    expect(order).toEqual(ALL_MODULES.filter((m) => order.includes(m)));
    expect(groups.every((g) => g.lessons.length > 0)).toBe(true);
    expect(groups.every((g) => g.label === MODULE_LABELS[g.module])).toBe(true);
  });

  it("every lesson appears in exactly one group", () => {
    const grouped = lessonsByModule().flatMap((g) => g.lessons);
    expect(grouped).toHaveLength(LESSONS.length);
  });

  it("lessonsFor drives the module link and matches the grouping", () => {
    for (const g of lessonsByModule()) {
      expect(lessonsFor(g.module)).toEqual(g.lessons);
    }
  });

  it("a lesson with no url counts as قريباً", () => {
    const fake = [
      { id: "a", title: "A", module: "sales" as const, url: "https://x" },
      { id: "b", title: "B", module: "sales" as const },
    ];
    expect(progress(fake)).toEqual({ total: 2, live: 1, soon: 1 });
  });

  it("every lesson says what it teaches", () => {
    // The outcome is the whole value of the card — a title alone doesn't tell
    // anyone whether the lesson answers their question.
    for (const l of LESSONS) {
      expect(l.outcome, `lesson "${l.id}"`).toBeTruthy();
    }
  });
});
