import { describe, expect, it } from "vitest";
import { pickable, templateClipboard, templateProject } from "./templateProject";

const files = {
  "menus/daily.yaml":
    "schema: menu/v1\nsize: 27\ntitle: Daily\nitems:\n  sword:\n    material: diamond_sword\n    slot: 4\n    title: The sword\n",
};

describe("a template's default version", () => {
  it("reads its menus and items without a manifest", () => {
    const project = templateProject("quests", "daily", files);
    expect(pickable(project).menus.map((m) => m.id)).toEqual(["daily"]);
  });

  it("copies a picked menu with its texts", () => {
    const project = templateProject("quests", "daily", files);
    const payload = templateClipboard(project, { menus: ["daily"], commands: [], elements: [] });
    expect(payload.menus.map((m) => m.id)).toEqual(["daily"]);
    expect(Object.values(payload.texts ?? {}).length).toBeGreaterThan(0);
  });
});
