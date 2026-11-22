import { describe, expect, test } from "vitest";
import { textPlacementsFromMenus } from "./menuTextPlacements";

const pairs = (yaml: string) =>
  [
    ...new Set(
      textPlacementsFromMenus([{ path: "menus/m.yaml", content: yaml }]).map(
        (p) => `${p.y}@${p.size}`,
      ),
    ),
  ].sort();

describe("textPlacementsFromMenus", () => {
  test("a text layer: its Y and size, clamped like TitleCompiler; a bad size is 8", () => {
    expect(
      pairs(`
id: m
size: 27
title:
  - { kind: text, value: a, x: 8, y: 20, size: 12 }
  - { kind: text, value: b, y: -50, size: 16 }
  - { kind: text, value: c, y: 500, size: 10 }
  - { kind: text, value: d }
  - { kind: glyph, asset: x, y: 30 }
  - plain
`),
    ).toEqual(["-3@16", "172@8", "20@12", "5@8"]);
  });

  test("a textarea: every line down to Y 172, lines above the floor drawn at it", () => {
    expect(
      pairs(
        "id: m\nsize: 27\ntitle: { kind: textarea, value: a, y: 150, size: 12, line_height: 9 }\n",
      ),
    ).toEqual(["150@12", "159@12", "168@12"]);
    // Line height is capped at 32. Floor of size 12 is Y 1: the line at -19 is drawn there.
    expect(
      pairs(
        "id: m\nsize: 27\ntitle: [{ kind: textarea, value: a, y: -19, size: 12, line_height: 80 }]\n",
      ),
    ).toEqual(["109@12", "13@12", "141@12", "1@12", "45@12", "77@12"]);
    expect(pairs("id: m\nsize: 27\ntitle: [{ kind: textarea, value: a, y: 173 }]\n")).toEqual([]);
  });

  test("a label: centred in its button's rectangle, each state's own, lines below it too", () => {
    const found = pairs(`
id: m
size: 27
elements:
  - id: freezes
    positions: "7-8"
    label: { text: "{a}/{b}", size: 12, offset_y: 3 }
    states:
      - if: [{ expression: x }]
        label: { text: Claim, size: 16 }
  - id: rows
    positions: "9-17"
    iterates: { source: days }
    label: { text: no, size: 24 }
`);
    // Slots 7-8: y 17, 18 high. Size 12: 17 + trunc((18 - 10) / 2) + 3 = 24, lines every 14.
    expect(found).toContain("24@12");
    expect(found).toContain("38@12");
    // Size 16: 17 + trunc((18 - 14) / 2) = 19, lines every 18.
    expect(found).toContain("19@16");
    expect(found).toContain("37@16");
    expect(found.some((p) => p.endsWith("@24"))).toBe(false);
  });

  test("only menus are read, and an unreadable one is skipped", () => {
    expect(
      textPlacementsFromMenus([
        { path: "lang/en.yaml", content: "title: [{ kind: text, y: 9, size: 12 }]" },
        { path: "menus/bad.yaml", content: "title: [" },
      ]),
    ).toEqual([]);
  });
});
