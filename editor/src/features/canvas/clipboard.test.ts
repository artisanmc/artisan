import { menusOf } from "@/domain/documents";
import { mockOpenProjects } from "@/mock/fixtures";
import { describe, expect, it } from "vitest";
import { rewriteIds } from "./clipboard";

describe("rewriteIds", () => {
  const personal = mockOpenProjects().projects[0]!;

  it("assigns new menu/command/layer/element ids", () => {
    const { menus } = rewriteIds({ menus: [menusOf(personal)[0]!], commands: [] });
    const original = menusOf(personal)[0]!;
    expect(menus[0]!.id).not.toBe(original.id);
    expect(menus[0]!.layers[0]!.id).not.toBe(original.layers[0]!.id);
    if (original.layers[0]!.elements[0]) {
      expect(menus[0]!.layers[0]!.elements[0]!.id).not.toBe(original.layers[0]!.elements[0]!.id);
    }
  });

  it("rewrites open_menu actions targeting menus inside the same paste set", () => {
    // m_shop_main + m_profile together — the shop main has a click → m_profile,
    // and rewriteIds should remap that target to the new m_profile id.
    const shopMain = menusOf(personal).find((m) => m.id === "m_shop_main")!;
    const profile = menusOf(personal).find((m) => m.id === "m_profile")!;
    const { menus } = rewriteIds({ menus: [shopMain, profile], commands: [] });
    const newShopMain = menus[0]!;
    const newProfile = menus[1]!;
    const firstStep = newShopMain.layers[0]!.elements[0]!.display!.click!.left!.steps[0]!;
    if (firstStep.kind !== "action") throw new Error("expected action step");
    const action = firstStep.action;
    expect(action.name).toBe("open_menu");
    expect(action.value).toBe(newProfile.id);
  });

  it("leaves open_menu targets that aren't in the paste set untouched", () => {
    const shopMain = menusOf(personal).find((m) => m.id === "m_shop_main")!;
    const { menus } = rewriteIds({ menus: [shopMain], commands: [] });
    const firstStep = menus[0]!.layers[0]!.elements[0]!.display!.click!.left!.steps[0]!;
    if (firstStep.kind !== "action") throw new Error("expected action step");
    const action = firstStep.action;
    expect(action.name).toBe("open_menu");
    expect(action.value).toBe("m_profile"); // left dangling — runtime no-ops on missing targets
  });
});
