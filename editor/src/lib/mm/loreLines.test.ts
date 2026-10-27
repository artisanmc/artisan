import { describe, expect, it } from "vitest";
import { renderLore, sourceLines } from "./loreLines";

const values: Record<string, string> = { "{a}": "", "{b}": "<red>", "{c}": "Chef" };
const render = (line: string) => line.replace(/\{\w\}/g, (m) => values[m] ?? m);

describe("renderLore", () => {
  it("drops a line whose expressions give nothing, keeps one left empty as written", () => {
    expect(renderLore("Grade : {c}\n\n{a}\n<gray>{b}\n{c}", render)).toEqual([
      "Grade : Chef",
      "",
      "Chef",
    ]);
  });

  it("keeps a newline inside an expression on its line", () => {
    expect(sourceLines("a{b\n}c\nd")).toEqual(["a{b\n}c", "d"]);
  });
});
