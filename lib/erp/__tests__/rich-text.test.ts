import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { renderRichText } from "@/lib/erp/rich-text";

// No JSX here on purpose: vitest only collects `*.test.ts`, and the parser needs no
// component to exercise it — it returns an element that renders straight to markup.
const NL = String.fromCharCode(10);
const html = (s: string | null | undefined) => {
  const node = renderRichText(s);
  return node === null ? null : renderToStaticMarkup(node as ReactElement);
};

describe("renderRichText", () => {
  it("keeps every typed line as its own line", () => {
    const out = html(`first${NL}second`)!;
    expect(out.match(/<p/g)).toHaveLength(2);
    expect(out).toContain("second");
  });

  it("renders the bold and italic markers", () => {
    const out = html("a **b** c *d*")!;
    expect(out).toContain("<b>b</b>");
    expect(out).toContain("<i>d</i>");
  });

  it("groups consecutive `- ` lines into one list", () => {
    const out = html(`terms:${NL}- one${NL}- two`)!;
    expect(out.match(/<ul/g)).toHaveLength(1);
    expect(out.match(/<li/g)).toHaveLength(2);
  });

  it("does not read a leading italic marker as a bullet", () => {
    // Only `* ` (marker then space) is a bullet; `*x*` is italic.
    expect(html("*x* rest")).not.toContain("<ul");
  });

  it("never emits markup that came from the text", () => {
    const out = html("<script>alert(1)</script> **ok**")!;
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("is null for an empty or blank note, so callers can fall back", () => {
    expect(html(null)).toBeNull();
    expect(html(`   ${NL}  `)).toBeNull();
  });
});
