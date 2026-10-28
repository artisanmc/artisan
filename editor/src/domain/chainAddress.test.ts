import { describe, expect, it } from "vitest";
import { type ChainAddress, chainActionContext, chainAllowsIf, chainTarget } from "./chainAddress";
import type { CommandId, DialogId, ElementId, MenuId } from "./types";

const element: ChainAddress = {
  kind: "element",
  menuId: "shop" as MenuId,
  elementId: "buy" as ElementId,
  stateIndex: 2,
  clickType: "right",
};
const command: ChainAddress = { kind: "command", commandId: "heal" as CommandId };
const dialogButton: ChainAddress = {
  kind: "dialogButton",
  dialogId: "confirm" as DialogId,
  buttonIndex: 1,
};

describe("chainTarget", () => {
  it("names an Element chain by its state as an appearance index", () => {
    expect(chainTarget(element)).toEqual({
      menuId: "shop",
      elementId: "buy",
      appearanceIndex: 2,
      clickType: "right",
    });
  });

  it("names a Command chain by the command id", () => {
    expect(chainTarget(command)).toEqual({ commandId: "heal" });
  });

  it("names a Dialog button chain by dialog and button index", () => {
    expect(chainTarget(dialogButton)).toEqual({ dialogId: "confirm", buttonIndex: 1 });
  });
});

describe("chainActionContext", () => {
  it("gives the menu context of an Element click handler", () => {
    expect(chainActionContext(element)).toEqual({
      menuId: "shop",
      elementId: "buy",
      clickType: "right",
    });
  });

  it("is empty outside a menu", () => {
    expect(chainActionContext(command)).toEqual({});
    expect(chainActionContext(dialogButton)).toEqual({});
  });
});

describe("chainAllowsIf", () => {
  it("allows if branches except on a Dialog button", () => {
    expect(chainAllowsIf(element)).toBe(true);
    expect(chainAllowsIf(command)).toBe(true);
    expect(chainAllowsIf(dialogButton)).toBe(false);
  });
});
