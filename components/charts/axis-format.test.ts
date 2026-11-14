import { describe, expect, it } from "vitest";
import { chartAxisNumber, shortChartLabel } from "./axis-format";

describe("chart labels in constrained space", () => {
  it("keeps large and negative financial ticks short", () => {
    expect(chartAxisNumber(1500)).toBe("1.5k");
    expect(chartAxisNumber(-1500)).toBe("-1.5k");
    expect(chartAxisNumber(1234567)).toBe("1.2m");
    expect(chartAxisNumber(499)).toBe("499");
  });
  it("preserves short Arabic labels and avoids breaking Unicode characters", () => {
    expect(shortChartLabel("يناير")).toBe("يناير");
    expect(shortChartLabel("📦".repeat(25))).toBe("📦".repeat(17) + "…");
    expect(Array.from(shortChartLabel("A very long product name with many words"))).toHaveLength(18);
  });
});
