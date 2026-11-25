// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { decodePng } from "./png";
import { KIT_RAMPS, kitRamp, rampPicked, rampShade, rampTable, withRamp } from "./ramps";
import { themeColors } from "./theme";

const KIT_DIR = resolve(__dirname, "../../assets/kit");
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const primary = kitRamp("primary")!;
const neutral = kitRamp("neutral")!;

/** Lightness in 0..510: the sum of the highest and the lowest channel. */
const lightness = (color: number) => {
  const channels = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  return Math.max(...channels) + Math.min(...channels);
};

describe("the base's colour ramps", () => {
  test("every colour of the base's images is in one ramp, and one only", () => {
    const seen = new Set<number>();
    for (const file of readdirSync(KIT_DIR).filter((name) => name.endsWith(".png"))) {
      const image = decodePng(new Uint8Array(readFileSync(resolve(KIT_DIR, file))));
      for (let i = 0; i < image.data.length; i += 4) {
        if (image.data[i + 3] === 0) continue;
        seen.add((image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!);
      }
    }
    const declared = KIT_RAMPS.flatMap((ramp) => ramp.shades);
    // No colour twice, in a ramp or across two.
    expect(new Set(declared).size).toBe(declared.length);
    expect([...seen].map(hex).sort()).toEqual(declared.map(hex).sort());
  });

  test("each ramp has a name of its own and its main colour among its shades", () => {
    expect(KIT_RAMPS.map((ramp) => ramp.id)).toEqual(["primary", "danger", "accent", "neutral"]);
    for (const ramp of KIT_RAMPS) expect(ramp.shades).toContain(ramp.main);
    expect(kitRamp("absent")).toBeUndefined();
  });

  test("the main colour becomes the picked one, each shade keeps its place around it", () => {
    const picked = 0xb3261e;
    expect(rampShade(primary, primary.main, picked)).toBe(picked);
    // Darker shades stay darker than the main colour, lighter ones lighter, in their order.
    const before = [...primary.shades].sort((a, b) => lightness(a) - lightness(b));
    const after = before.map((shade) => rampShade(primary, shade, picked));
    for (let i = 1; i < after.length; i++)
      expect(lightness(after[i]!)).toBeGreaterThanOrEqual(lightness(after[i - 1]!));
    // Every shade takes the picked colour's hue: red is its highest channel.
    for (const shade of after) {
      const [r, g, b] = [(shade >> 16) & 255, (shade >> 8) & 255, shade & 255];
      expect(r).toBeGreaterThanOrEqual(Math.max(g!, b!));
    }
  });

  test("black stays black and white stays white, a grey takes the picked colour's tint", () => {
    const picked = 0x4a5a8c;
    expect(rampShade(neutral, 0x000000, picked)).toBe(0x000000);
    expect(rampShade(neutral, 0xffffff, picked)).toBe(0xffffff);
    const dark = rampShade(neutral, 0x555555, picked);
    expect(dark & 255).toBeGreaterThan((dark >> 16) & 255);
    expect(lightness(dark)).toBeLessThan(lightness(picked));
  });

  test("the table of a ramp left at its main colour is empty", () => {
    expect(rampTable(primary, primary.main).size).toBe(0);
    const table = rampTable(primary, 0xb3261e);
    expect(table.get(primary.main)).toBe(0xb3261e);
    expect([...table.keys()].every((from) => primary.shades.includes(from))).toBe(true);
    // A shade that does not change is left out.
    expect(rampTable(neutral, 0xc0c0c0).has(0x000000)).toBe(false);
  });

  test("a ramp changed in a theme's table leaves the other entries as they are", () => {
    const colors = themeColors('colors:\n  "#a02824": "#102030"\n  "#123456": "#654321"\n');
    const next = withRamp(colors, primary, 0xb3261e);
    expect(next.get(0xa02824)).toBe(0x102030);
    expect(next.get(0x123456)).toBe(0x654321);
    expect(rampPicked(primary, next)).toBe(0xb3261e);
    expect(rampPicked(primary, colors)).toBe(primary.main);
    // Picked again, the ramp's former entries go; back to the main colour, they all do.
    const again = withRamp(next, primary, 0x2050c0);
    expect(rampPicked(primary, again)).toBe(0x2050c0);
    expect(again.size).toBe(next.size);
    expect([...withRamp(again, primary, primary.main)]).toEqual([...colors]);
  });
  test("the shades are the ones the hub computes (testdata/ramp-shades-conformance.json)", () => {
    const vectors = JSON.parse(
      readFileSync(resolve(__dirname, "../../../../testdata/ramp-shades-conformance.json"), "utf8"),
    ) as { cases: { ramp: string; picked: string; table: Record<string, string> }[] };
    expect(vectors.cases.length).toBeGreaterThan(0);
    for (const { ramp, picked, table } of vectors.cases) {
      const computed = rampTable(kitRamp(ramp)!, Number.parseInt(picked.slice(1), 16));
      expect(
        Object.fromEntries([...computed].map(([from, to]) => [hex(from), hex(to)])),
        `${ramp} ${picked}`,
      ).toEqual(table);
    }
  });
});
