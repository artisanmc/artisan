import { describe, expect, it } from "vitest";
import { scaledAdvance } from "./VanillaMcText";
import { scaledLineWidthJs } from "./composer/TitleRender";

describe("scaled text widths (mirror of TitleCompiler.scaledLineWidth)", () => {
  it("adds 1 px per bold glyph whatever the size, rounding glyph by glyph", () => {
    expect(scaledLineWidthJs("Jour", 8)).toBe(24);
    expect(scaledLineWidthJs("<bold>Jour</bold>", 8)).toBe(28);
    expect(scaledLineWidthJs("Jour", 12)).toBe(36);
    expect(scaledLineWidthJs("<b>Jour</b>", 12)).toBe(40);
    expect(scaledLineWidthJs(" ", 12)).toBe(6);
    expect(scaledLineWidthJs("<bold> </bold>", 12)).toBe(7);
    expect(scaledLineWidthJs("Hello", 16)).toBe(43);
  });

  it("is the vanilla advance at size 8", () => {
    expect(scaledAdvance("l", 1)).toBe(3);
    expect(scaledAdvance("l", 2)).toBe(5);
  });
});
