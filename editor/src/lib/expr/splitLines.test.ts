import { describe, expect, it } from "vitest";
import { parse } from "./parser";
import { printExpression } from "./print";
import { splitIntoLines } from "./splitLines";

describe("printExpression", () => {
  it("prints back what parses to the same tree", () => {
    for (const src of [
      'a ? "x" : b ? "y" : "z"',
      "(a || b) && !c.d",
      'm.joined.ago() + " · " + list.join(", ")',
      "a - (b - c)",
      "x[0].name == %player_name%",
    ]) {
      const ast = parse(src);
      expect(parse(printExpression(ast))).toEqual(
        parse(printExpression(parse(printExpression(ast)))),
      );
      expect(JSON.stringify(stripPos(parse(printExpression(ast))))).toBe(
        JSON.stringify(stripPos(ast)),
      );
    }
  });
});

describe("splitIntoLines", () => {
  it("puts each rule glued with \\n on its own line", () => {
    const src =
      '(m.online ? "<green>En ligne" : "<gray>Hors ligne") + (m.can_promote || m.can_kick ? "\\n" : "") + (m.can_promote ? "\\n<yellow>Promouvoir" : "") + (m.can_kick ? "\\n<red>Exclure" : "")';
    expect(splitIntoLines(src)).toEqual([
      '{m.online ? "<green>En ligne" : "<gray>Hors ligne"}',
      "",
      '{m.can_promote ? "<yellow>Promouvoir" : ""}',
      '{m.can_kick ? "<red>Exclure" : ""}',
    ]);
  });

  it("splits a text on its breaks and leaves a single line alone", () => {
    expect(splitIntoLines('"Grade : " + m.rank + "\\nDepuis " + m.joined.ago()')).toEqual([
      "Grade : {m.rank}",
      "Depuis {m.joined.ago()}",
    ]);
    expect(splitIntoLines('m.online ? "a" : "b"')).toBeNull();
  });
});

function stripPos(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripPos);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== "pos")
        .map(([k, x]) => [k, stripPos(x)]),
    );
  return v;
}
