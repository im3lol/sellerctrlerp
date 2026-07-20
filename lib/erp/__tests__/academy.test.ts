import { describe, it, expect } from "vitest";
import {
  moduleCards, progress, isModuleKey, isLive, lessonHref, opensInApp, byKind,
  isLessonKind, KIND_LABELS, KIND_PLURAL, KIND_ICONS, LESSON_KINDS, MODULE_ICONS,
  ACADEMY_ADMIN_ONLY, ACADEMY_CAPABILITY,
  type Lesson, type LessonKind,
} from "../academy-core";
import { ALL_MODULES, MODULE_LABELS } from "../module-list";
import { can } from "../../rbac";

const YT = "https://youtu.be/dQw4w9WgXcQ";

const video = (id: string, module: string, url?: string): Lesson => ({
  id, slug: id, title: id, module: module as Lesson["module"], kind: "video",
  outcome: null, url: url ?? null, body: null, minutes: null, level: "basic",
});
const doc = (id: string, module: string, body?: string): Lesson => ({
  id, slug: id, title: id, module: module as Lesson["module"], kind: "doc",
  outcome: null, url: null, body: body ?? null, minutes: null, level: "basic",
});

describe("ACADEMY_CAPABILITY — the hide switch", () => {
  it("the capability it picks actually excludes tenants", () => {
    // The whole hide rests on employee.manage being system_admin-only. If someone
    // ever grants it to org_admin, the academy silently unhides for every customer
    // and nothing else would catch it.
    if (!ACADEMY_ADMIN_ONLY) return;
    expect(ACADEMY_CAPABILITY).toBe("employee.manage");
    expect(can("system_admin", "employee.manage")).toBe(true);
    for (const role of ["org_admin", "ops_manager", "team_lead", "employee", "client"] as const) {
      expect(can(role, "employee.manage"), `role "${role}" must not see the academy`).toBe(false);
    }
  });

  it("flipping the flag off drops the gate entirely", () => {
    // Pins the release path: one constant, and the nav entry stops being gated.
    expect(ACADEMY_CAPABILITY).toBe(ACADEMY_ADMIN_ONLY ? "employee.manage" : undefined);
  });
});

describe("isModuleKey", () => {
  it("accepts real modules and rejects anything else", () => {
    // Guards the /erp/academy/[module] route — the segment is user-supplied, so a
    // bad one must 404 rather than render an empty module that looks real.
    expect(isModuleKey("sales")).toBe(true);
    expect(isModuleKey("purchases")).toBe(true);
    expect(isModuleKey("purchase")).toBe(false);   // near miss
    expect(isModuleKey("")).toBe(false);
    expect(isModuleKey("../admin")).toBe(false);
  });
});

describe("isLessonKind", () => {
  it("guards the two catalogues", () => {
    expect(isLessonKind("video")).toBe(true);
    expect(isLessonKind("doc")).toBe(true);
    expect(isLessonKind("docs")).toBe(false);
    expect(isLessonKind("")).toBe(false);
  });

  it("every kind has a label, a plural and an icon", () => {
    for (const k of LESSON_KINDS) {
      expect(KIND_LABELS[k], k).toBeTruthy();
      expect(KIND_PLURAL[k], k).toBeTruthy();
      expect(KIND_ICONS[k], k).toBeTruthy();
    }
  });
});

describe("isLive", () => {
  it("each kind is judged on its OWN content field", () => {
    // The whole point of the split: a video needs a link, a guide needs text.
    expect(isLive(video("a", "sales", YT))).toBe(true);
    expect(isLive(video("b", "sales"))).toBe(false);
    expect(isLive(doc("c", "sales", "## شرح"))).toBe(true);
    expect(isLive(doc("d", "sales"))).toBe(false);
  });

  it("a video is not live just because some text got left on the row", () => {
    // A lesson flipped doc→video keeps its body in the DB until saved; it must read
    // قريباً, not متاح, or the page opens onto an empty player.
    const stale: Lesson = { ...video("e", "sales"), body: "## leftover" };
    expect(isLive(stale)).toBe(false);
  });

  it("a guide is not live just because a url got left on the row", () => {
    const stale: Lesson = { ...doc("f", "sales"), url: YT };
    expect(isLive(stale)).toBe(false);
  });
});

describe("lessonHref / opensInApp", () => {
  it("a YouTube video opens in-app — it plays there", () => {
    expect(lessonHref(video("a", "sales", YT))).toBe("/academy/sales/a");
    expect(opensInApp(video("a", "sales", YT))).toBe(true);
  });

  it("a guide opens in-app", () => {
    expect(lessonHref(doc("b", "sales", "## شرح"))).toBe("/academy/sales/b");
  });

  it("a video we cannot embed leaves for its own host", () => {
    // Vimeo won't play in our page, so a page here would be one outbound link.
    const v = video("c", "sales", "https://vimeo.com/123456");
    expect(opensInApp(v)).toBe(false);
    expect(lessonHref(v)).toBe("https://vimeo.com/123456");
  });

  it("قريباً has nowhere to go", () => {
    expect(lessonHref(video("d", "sales"))).toBeNull();
    expect(lessonHref(doc("e", "sales"))).toBeNull();
  });
});

describe("byKind", () => {
  it("splits the catalogues", () => {
    const all = [video("a", "sales", YT), doc("b", "sales", "x"), video("c", "hr")];
    expect(byKind(all, "video").map((l) => l.id)).toEqual(["a", "c"]);
    expect(byKind(all, "doc").map((l) => l.id)).toEqual(["b"]);
  });
});

describe("moduleCards", () => {
  it("returns one card per module, in sidebar order", () => {
    expect(moduleCards([]).map((c) => c.module)).toEqual([...ALL_MODULES]);
  });

  it("keeps modules with no lessons — an empty card is the point", () => {
    // Dropping them would hide the gap; the card is how the owner sees what still
    // needs recording.
    const cards = moduleCards([video("a", "sales", YT)]);
    expect(cards).toHaveLength(ALL_MODULES.length);
    expect(cards.find((c) => c.module === "hr")!.total).toBe(0);
  });

  it("counts each catalogue separately on the same card", () => {
    const cards = moduleCards([
      video("a", "sales", YT), video("b", "sales"),
      doc("c", "sales", "## x"), doc("d", "sales"), doc("e", "sales", "## y"),
    ]);
    const sales = cards.find((c) => c.module === "sales")!;
    expect(sales.videos).toEqual({ total: 2, live: 1, soon: 1 });
    expect(sales.docs).toEqual({ total: 3, live: 2, soon: 1 });
    expect(sales).toMatchObject({ total: 5, live: 3, soon: 2 });
  });

  it("a lesson with an unknown module lands on no card", () => {
    // The owner picks the module from a fixed list, so this shouldn't happen — but
    // if it ever does it fails quietly (the lesson just disappears), so pin it.
    expect(moduleCards([video("a", "nonsense", YT)]).reduce((s, c) => s + c.total, 0)).toBe(0);
  });

  it("labels and icons come from the shared module list", () => {
    for (const c of moduleCards([])) {
      expect(c.label).toBe(MODULE_LABELS[c.module]);
      expect(c.icon).toBe(MODULE_ICONS[c.module]);
    }
  });

  it("every module has an icon", () => {
    for (const m of ALL_MODULES) expect(MODULE_ICONS[m], `module "${m}"`).toBeTruthy();
  });
});

describe("progress", () => {
  it("reports the two catalogues plus the combined total", () => {
    const p = progress([video("a", "sales", YT), video("b", "sales"), doc("c", "hr", "## x")]);
    expect(p.videos).toEqual({ total: 2, live: 1, soon: 1 });
    expect(p.docs).toEqual({ total: 1, live: 1, soon: 0 });
    expect(p).toMatchObject({ total: 3, live: 2, soon: 1 });
  });

  it("empty catalogue", () => {
    expect(progress([])).toMatchObject({ total: 0, live: 0, soon: 0 });
  });

  it("the split always adds back up to the whole", () => {
    // Guards against a lesson being counted in one catalogue but not the total.
    const all: Lesson[] = [video("a", "sales", YT), doc("b", "hr", "## x"), video("c", "hr")];
    const p = progress(all);
    for (const f of ["total", "live", "soon"] as const) {
      expect(p.videos[f] + p.docs[f], f).toBe(p[f]);
    }
  });
});
