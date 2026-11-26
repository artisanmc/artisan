import { describe, expect, it } from "vitest";
import { themePlaceMark } from "./themePlaceMark";

describe("themePlaceMark", () => {
  const server = new Set(["button.3x1", "blason"]);

  it("says an image replaces the base when a place below has its name", () => {
    // A piece of Artisan's base, from the server's theme or another.
    expect(themePlaceMark("button.3x1", "server", server)).toBe("replacesBase");
    expect(themePlaceMark("close.1x1", "theme", server)).toBe("replacesBase");
    // An image the server's theme added is below another theme.
    expect(themePlaceMark("blason", "theme", server)).toBe("replacesBase");
  });

  it("says an image is added here when no place below has its name", () => {
    // Nothing is below the server's theme but the base.
    expect(themePlaceMark("blason", "server", server)).toBe("addedHere");
    expect(themePlaceMark("garland", "theme", server)).toBe("addedHere");
  });
});
