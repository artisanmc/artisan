import { describe, expect, it } from "vitest";
import { defaultItemMatch, readItemMatch } from "./itemMatch";
import type { Project } from "./types";

const project = {
  capturedItems: [
    {
      id: "rod",
      name: "Rod",
      stackYaml: "",
      display: { material: "FISHING_ROD", enchanted: true },
    },
    { id: "ruby", name: "Ruby", stackYaml: "", display: { material: "nexo:ruby", name: "Ruby" } },
  ],
} as unknown as Project;

describe("defaultItemMatch", () => {
  it("reads the criteria off the spec's fields", () => {
    expect(defaultItemMatch(project, { material: "DIAMOND" })).toEqual(["material", "damage"]);
    expect(
      defaultItemMatch(project, {
        material: "DIAMOND_SWORD",
        title: "<red>Excalibur",
        enchants: { sharpness: 5 },
      }),
    ).toEqual(["material", "name", "enchants", "damage"]);
    expect(defaultItemMatch(project, { material: "nexo:ruby" })).toEqual(["custom_item", "damage"]);
  });

  it("reads a captured item's own name and custom ref", () => {
    expect(defaultItemMatch(project, { material: "item:ruby" })).toEqual([
      "custom_item",
      "name",
      "damage",
    ]);
  });
});

describe("readItemMatch", () => {
  it("keeps known ids in wire order", () => {
    expect(readItemMatch(["Enchants", "material", "repair"])).toEqual(["material", "enchants"]);
    expect(readItemMatch(undefined)).toBeUndefined();
    expect(readItemMatch([])).toEqual([]);
  });
});
