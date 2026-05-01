import { describe, expect, it } from "vitest";
import { addPosition, formatPositions, parsePositions, removePosition } from "./positions";

describe("parsePositions", () => {
  it("parses a single index", () => {
    expect(parsePositions("13")).toEqual([13]);
  });
  it("parses a comma-separated list", () => {
    expect(parsePositions("0,1,2")).toEqual([0, 1, 2]);
  });
  it("expands a range", () => {
    expect(parsePositions("0-4")).toEqual([0, 1, 2, 3, 4]);
  });
  it("combines lists and ranges and dedupes", () => {
    expect(parsePositions("0-3,2,5,7-8")).toEqual([0, 1, 2, 3, 5, 7, 8]);
  });
  it("returns [] on empty / invalid", () => {
    expect(parsePositions("")).toEqual([]);
    expect(parsePositions("nope")).toEqual([]);
  });
});

describe("formatPositions", () => {
  it("empty list → empty string", () => {
    expect(formatPositions([])).toBe("");
  });
  it("single index", () => {
    expect(formatPositions([13])).toBe("13");
  });
  it("compresses consecutive runs", () => {
    expect(formatPositions([0, 1, 2, 3])).toBe("0-3");
  });
  it("mixed ranges and singletons", () => {
    expect(formatPositions([0, 1, 2, 5, 7, 8])).toBe("0-2,5,7-8");
  });
});

describe("removePosition / addPosition", () => {
  it("removes a position from a range, splitting if necessary", () => {
    expect(removePosition("0-4", 2)).toBe("0-1,3-4");
  });
  it("removes a singleton", () => {
    expect(removePosition("0,5,7", 5)).toBe("0,7");
  });
  it("returns empty when removing the only position", () => {
    expect(removePosition("13", 13)).toBe("");
  });
  it("adds a new position keeping the canonical form", () => {
    expect(addPosition("0-2", 4)).toBe("0-2,4");
    expect(addPosition("0-2", 3)).toBe("0-3");
  });
});
