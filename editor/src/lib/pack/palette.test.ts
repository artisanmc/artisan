import { describe, expect, test } from "vitest";
import { DEFAULT_PALETTE, paletteOf, readPalette, tintOf } from "./palette";

describe("palette", () => {
  test("a palette.yml gives its names their colours, an entry that is no name or no colour left out", () => {
    const read = readPalette(
      'primary: "#B3261E"\ndanger: red\nwarning: "#fff"\nBad Name: "#000000"\ngold: "#d4a017"\nn: 12\n',
    );
    expect([...read]).toEqual([
      ["primary", "#B3261E"],
      ["gold", "#d4a017"],
    ]);
    for (const content of ["", "- a\n- b\n", "primary: [", "just text"]) {
      expect(readPalette(content).size).toBe(0);
    }
  });

  test("a name is looked up from the highest place down, then in the default palette", () => {
    const palette = paletteOf([
      'primary: "#b3261e"\ndanger: red\n',
      undefined,
      'primary: "#101820"\ndanger: "#600000"\n',
      'gold: "#d4a017"\ndanger: "#990000"\n',
    ]);
    expect(palette("primary")).toBe("#b3261e");
    expect(palette("danger")).toBe("#600000");
    expect(palette("gold")).toBe("#d4a017");
    expect(palette("success")).toBe(DEFAULT_PALETTE.success);
    expect(palette("nowhere")).toBeUndefined();
    expect(paletteOf([])("primary")).toBe(DEFAULT_PALETTE.primary);
  });

  test("a tint is its own colour when it is one, else the palette's of that name", () => {
    const palette = paletteOf(['primary: "#b3261e"\n']);
    expect(tintOf(undefined, palette)).toBeUndefined();
    expect(tintOf("#C03366", palette)).toBe("#C03366");
    expect(tintOf("primary", palette)).toBe("#b3261e");
    expect(tintOf("nowhere", palette)).toBeUndefined();
    expect(tintOf("primary")).toBeUndefined();
  });
});
