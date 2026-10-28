import { describe, expect, it } from "vitest";
import { defaultAction, defaultDeclaredAction } from "./defaults";

describe("defaultDeclaredAction", () => {
  it("seeds the required and defaulted arguments in the canonical shape", () => {
    expect(
      defaultDeclaredAction({
        name: "quests:refresh",
        moduleId: "quests",
        primary: null,
        args: [],
      }),
    ).toEqual({ name: "quests:refresh", value: null });
    expect(
      defaultDeclaredAction({
        name: "quests:start",
        moduleId: "quests",
        primary: "quest",
        args: [
          { name: "quest", type: { kind: "string" }, required: true },
          { name: "silent", type: { kind: "boolean" } },
        ],
      }),
    ).toEqual({ name: "quests:start", value: "" });
    expect(
      defaultDeclaredAction({
        name: "quests:start",
        moduleId: "quests",
        primary: "quest",
        args: [
          { name: "quest", type: { kind: "string" }, required: true },
          { name: "silent", type: { kind: "boolean" }, default: false },
        ],
      }),
    ).toEqual({ name: "quests:start", value: "" });
  });
});

describe("defaultAction", () => {
  it("seeds a core action from the shared table, with the editor's starting values", () => {
    expect(defaultAction("close_menu")).toEqual({ name: "close_menu", value: null });
    expect(defaultAction("open_menu", "shop" as never)).toEqual({
      name: "open_menu",
      value: "shop",
    });
    expect(defaultAction("give_item")).toEqual({
      name: "give_item",
      value: { material: "DIAMOND", count: 1 },
    });
    expect(defaultAction("send_message")).toEqual({ name: "send_message", value: { key: "" } });
    expect(defaultAction("set_arg")).toEqual({ name: "set_arg", value: { arg: "", value: '""' } });
    expect(defaultAction("teleport")).toEqual({
      name: "teleport",
      value: { world: "world", x: 0, y: 64, z: 0 },
    });
  });
});
