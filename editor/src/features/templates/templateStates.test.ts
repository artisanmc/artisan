import type { TemplateInfo } from "@/lib/api/templates";
import { describe, expect, it } from "vitest";
import { announcedTemplates, originOf, templateState } from "./templateStates";

const template: TemplateInfo = {
  id: "daily",
  title: "Daily quests",
  version: 2,
  files: [
    { path: "quest_groups/daily.yaml", hash: "g2", size: 1 },
    { path: "menus/daily.yaml", hash: "m1", size: 1 },
  ],
};

const origin = (hash: string, version = 1) => ({
  module: "quests",
  template: "daily",
  version,
  hash,
});

describe("templateState", () => {
  it("tells absent files from the Project's own", () => {
    const state = templateState("quests", template, {}, { "menus/daily.yaml": "mine" });
    expect(state.files.map((f) => f.status)).toEqual(["absent", "occupied"]);
    expect(state.copied).toBe(false);
  });

  it("reads copies as identical, modified or removed, and offers newer shipped versions", () => {
    const state = templateState(
      "quests",
      template,
      { "quest_groups/daily.yaml": origin("g1"), "menus/daily.yaml": origin("m1") },
      { "quest_groups/daily.yaml": "g1", "menus/daily.yaml": "edited" },
    );
    expect(state.files).toEqual([
      { path: "quest_groups/daily.yaml", status: "identical", updateAvailable: true },
      { path: "menus/daily.yaml", status: "modified", updateAvailable: false },
    ]);
    expect(state.copied).toBe(true);
    expect(state.updateAvailable).toBe(true);

    const removed = templateState("quests", template, { "menus/daily.yaml": origin("m1") }, {});
    expect(removed.files[1]).toEqual({
      path: "menus/daily.yaml",
      status: "removed",
      updateAvailable: false,
    });
  });

  it("counts a file already holding the shipped content as up to date", () => {
    const state = templateState(
      "quests",
      template,
      { "quest_groups/daily.yaml": origin("g1") },
      { "quest_groups/daily.yaml": "g2" },
    );
    expect(state.files[0]).toEqual({
      path: "quest_groups/daily.yaml",
      status: "identical",
      updateAvailable: false,
    });
  });

  it("ignores origins of another template", () => {
    const state = templateState(
      "quests",
      template,
      { "menus/daily.yaml": { ...origin("m0"), template: "weekly" } },
      { "menus/daily.yaml": "m0" },
    );
    expect(state.files[1]?.status).toBe("occupied");
  });
});

describe("announced templates", () => {
  const modules = [
    { id: "quests", version: "1", templates: [template] },
    { id: "shop", version: "1" },
  ];

  it("lists every module's templates", () => {
    expect(announcedTemplates(modules).map((t) => `${t.moduleId}/${t.template.id}`)).toEqual([
      "quests/daily",
    ]);
  });

  it("finds a file's template while it is announced", () => {
    expect(
      originOf("menus/daily.yaml", { "menus/daily.yaml": origin("m1") }, modules)?.template.id,
    ).toBe("daily");
    expect(originOf("menus/other.yaml", { "menus/other.yaml": origin("m1") }, modules)).toBeNull();
    expect(originOf("menus/daily.yaml", {}, modules)).toBeNull();
  });
});
