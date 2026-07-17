import { describe, it, expect } from "vitest";
import {
  moduleCards, progress, isModuleKey, isLive, lessonHref, opensInApp,
  lessonFormat, FORMAT_LABELS, MODULE_ICONS, type Lesson,
} from "../academy-core";
import { ALL_MODULES, MODULE_LABELS } from "../module-list";

const YT = "https://youtu.be/dQw4w9WgXcQ";

const lesson = (id: string, module: string, url?: string, body?: string): Lesson => ({
  id, slug: id, title: id, module: module as Lesson["module"],
  outcome: null, url: url ?? null, body: body ?? null, minutes: null, level: "basic",
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

describe("moduleCards", () => {
  it("returns one card per module, in sidebar order", () => {
    const cards = moduleCards([]);
    expect(cards.map((c) => c.module)).toEqual([...ALL_MODULES]);
  });

  it("keeps modules with no lessons — an empty card is the point", () => {
    // Dropping them would hide the gap; the card is how the owner sees what still
    // needs recording.
    const cards = moduleCards([lesson("a", "sales")]);
    expect(cards).toHaveLength(ALL_MODULES.length);
    expect(cards.find((c) => c.module === "hr")!.total).toBe(0);
  });

  it("counts live vs قريباً per module", () => {
    const cards = moduleCards([
      lesson("a", "sales", "https://x"),
      lesson("b", "sales"),
      lesson("c", "sales"),
      lesson("d", "hr", "https://y"),
    ]);
    const sales = cards.find((c) => c.module === "sales")!;
    expect(sales).toMatchObject({ total: 3, live: 1, soon: 2 });
    expect(cards.find((c) => c.module === "hr")).toMatchObject({ total: 1, live: 1, soon: 0 });
  });

  it("a lesson with an unknown module lands on no card", () => {
    // The owner picks the module from a fixed list, so this shouldn't happen — but
    // if it ever does it fails quietly (the lesson just disappears), so pin it.
    const cards = moduleCards([lesson("a", "nonsense")]);
    expect(cards.reduce((s, c) => s + c.total, 0)).toBe(0);
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

describe("isLive", () => {
  it("a video OR a doc is enough — neither is قريباً", () => {
    // The whole point of docs: a lesson goes live without anything being recorded.
    expect(isLive(lesson("a", "sales", "https://x"))).toBe(true);
    expect(isLive(lesson("b", "sales", undefined, "## شرح"))).toBe(true);
    expect(isLive(lesson("c", "sales", "https://x", "## شرح"))).toBe(true);
    expect(isLive(lesson("d", "sales"))).toBe(false);
  });
});

describe("lessonFormat", () => {
  it("video and article are peers, and a lesson can be both", () => {
    expect(lessonFormat(lesson("a", "sales", YT))).toBe("video");
    expect(lessonFormat(lesson("b", "sales", undefined, "## شرح"))).toBe("doc");
    expect(lessonFormat(lesson("c", "sales", YT, "## شرح"))).toBe("both");
    expect(lessonFormat(lesson("d", "sales"))).toBe("soon");
  });

  it("every format has a label", () => {
    for (const f of ["video", "doc", "both", "soon"] as const) expect(FORMAT_LABELS[f]).toBeTruthy();
  });
});

describe("lessonHref", () => {
  it("a YouTube lesson opens in-app — the video plays there", () => {
    // It used to link straight out to YouTube, which took the customer out of the
    // product to watch a lesson about the product.
    expect(lessonHref(lesson("a", "sales", YT))).toBe("/erp/academy/sales/a");
  });

  it("an article opens in-app", () => {
    expect(lessonHref(lesson("b", "sales", undefined, "## شرح"))).toBe("/erp/academy/sales/b");
  });

  it("both → one page that holds the video and the article", () => {
    expect(lessonHref(lesson("c", "purchases", YT, "## شرح"))).toBe("/erp/academy/purchases/c");
  });

  it("a video we cannot embed still leaves for its own host", () => {
    // Vimeo won't play in our page, so a page here would be one outbound link —
    // a wasted click. Send them straight there.
    expect(lessonHref(lesson("d", "sales", "https://vimeo.com/123456"))).toBe("https://vimeo.com/123456");
    expect(opensInApp(lesson("d", "sales", "https://vimeo.com/123456"))).toBe(false);
  });

  it("…unless it also has an article, which we CAN show", () => {
    expect(lessonHref(lesson("e", "sales", "https://vimeo.com/123456", "## شرح"))).toBe("/erp/academy/sales/e");
  });

  it("قريباً has nowhere to go", () => {
    expect(lessonHref(lesson("f", "sales"))).toBeNull();
    expect(opensInApp(lesson("f", "sales"))).toBe(false);
  });
});

describe("progress", () => {
  it("a lesson with neither video nor doc is قريباً", () => {
    expect(progress([lesson("a", "sales", "https://x"), lesson("b", "sales")]))
      .toEqual({ total: 2, live: 1, soon: 1 });
  });

  it("counts a doc-only lesson as متاح", () => {
    // Regression guard: the count used to key off url alone, which would have listed
    // a written lesson as قريباً on the card while its page rendered fine.
    expect(progress([lesson("a", "sales", undefined, "## شرح"), lesson("b", "sales")]))
      .toEqual({ total: 2, live: 1, soon: 1 });
  });

  it("empty catalogue", () => {
    expect(progress([])).toEqual({ total: 0, live: 0, soon: 0 });
  });
});
