import { describe, expect, it } from "vitest";
import { defaultModuleAction } from "./defaults";

describe("defaultModuleAction", () => {
  it("seeds the required and defaulted arguments in the canonical shape", () => {
    expect(
      defaultModuleAction({ name: "quests:refresh", moduleId: "quests", primary: null, args: [] }),
    ).toEqual({ type: "module", name: "quests:refresh", value: null });
    expect(
      defaultModuleAction({
        name: "quests:start",
        moduleId: "quests",
        primary: "quest",
        args: [
          { name: "quest", type: { kind: "string" }, required: true },
          { name: "silent", type: { kind: "boolean" } },
        ],
      }),
    ).toEqual({ type: "module", name: "quests:start", value: "" });
    expect(
      defaultModuleAction({
        name: "quests:start",
        moduleId: "quests",
        primary: "quest",
        args: [
          { name: "quest", type: { kind: "string" }, required: true },
          { name: "silent", type: { kind: "boolean" }, default: false },
        ],
      }),
    ).toEqual({ type: "module", name: "quests:start", value: { quest: "", silent: false } });
  });
});
