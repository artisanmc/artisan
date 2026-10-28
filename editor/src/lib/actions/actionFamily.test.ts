import { describe, expect, it } from "vitest";
import coreActions from "../../../../testdata/core-actions.json";
import { ACTION_FAMILIES, actionAppearance, isCoreAction } from "./actionFamily";

describe("actionAppearance", () => {
  it("gives every core action a family other than module", () => {
    for (const { name } of coreActions.actions) {
      expect(isCoreAction(name), name).toBe(true);
      expect(actionAppearance(name).family, name).not.toBe("module");
    }
  });

  it("files a module action, or an unknown one, under module", () => {
    expect(actionAppearance("quests:start").family).toBe("module");
    expect(actionAppearance("nope").family).toBe("module");
  });

  it("keeps the palette at seven families", () => {
    expect(ACTION_FAMILIES).toHaveLength(7);
  });
});
