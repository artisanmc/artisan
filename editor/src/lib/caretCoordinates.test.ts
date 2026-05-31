import { describe, expect, it } from "vitest";
import { getCaretCoordinates } from "./caretCoordinates";

describe("getCaretCoordinates", () => {
  it("returns x, y, height for an input element (jsdom returns 0 sensibly)", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);
    const c = getCaretCoordinates(input, 3);
    expect(typeof c.left).toBe("number");
    expect(typeof c.top).toBe("number");
    expect(c.height).toBeGreaterThanOrEqual(0);
    document.body.removeChild(input);
  });

  it("returns a sensible value for a textarea at end of text", () => {
    const ta = document.createElement("textarea");
    ta.value = "line1\nline2";
    document.body.appendChild(ta);
    const c = getCaretCoordinates(ta, ta.value.length);
    expect(typeof c.left).toBe("number");
    expect(typeof c.top).toBe("number");
    document.body.removeChild(ta);
  });
});
