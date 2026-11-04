import { describe, expect, it } from "vitest";
import { GAME_LANGUAGES, inventoryLabelFiles } from "./inventoryLabel";

describe("inventoryLabelFiles", () => {
  it("empties container.inventory in every language of the game, en_us included", () => {
    const files = inventoryLabelFiles();
    expect(Object.keys(files)).toHaveLength(GAME_LANGUAGES.length);
    expect(new Set(GAME_LANGUAGES).size).toBe(GAME_LANGUAGES.length);
    for (const code of ["en_us", "fr_fr", "de_de", "zh_cn"])
      expect(JSON.parse(files[`assets/minecraft/lang/${code}.json`] ?? "null")).toEqual({
        "container.inventory": "",
      });
  });
});
