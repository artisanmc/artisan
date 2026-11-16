import { type OptionList, optionListFromWire } from "@/lib/api/optionLists";
import { describe, expect, it } from "vitest";
import { optionsOf } from "./serverOptionListsStore";

describe("a server's option lists", () => {
  it("reads a declared list, leaving out options without a value", () => {
    expect(
      optionListFromWire({
        id: "quests:actor_types",
        options: [
          { value: "player" },
          { value: "guild", labels: { en: "Each guild", fr: "Chaque guilde", de: 3 } },
          { labels: { en: "Nothing" } },
          { value: "" },
        ],
      }),
    ).toEqual({
      id: "quests:actor_types",
      options: [
        { value: "player", labels: {} },
        { value: "guild", labels: { en: "Each guild", fr: "Chaque guilde" } },
      ],
    });
    expect(optionListFromWire({ options: [] })).toBeNull();
  });

  it("labels the options in the interface language, then English, then the value", () => {
    const lists: OptionList[] = [
      {
        id: "quests:actor_types",
        options: [
          { value: "player", labels: {} },
          { value: "guild", labels: { en: "Each guild", fr: "Chaque guilde" } },
        ],
      },
    ];
    expect(optionsOf(lists, "quests:actor_types", "fr")).toEqual([
      { value: "player", label: "player" },
      { value: "guild", label: "Chaque guilde" },
    ]);
    expect(optionsOf(lists, "quests:actor_types", "de")?.[1]?.label).toBe("Each guild");
    expect(optionsOf(lists, "quests:other", "fr")).toBeUndefined();
  });
});
