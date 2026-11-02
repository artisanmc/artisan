import { describe, expect, it } from "vitest";
import { profileForTextKey } from "./profiles";

describe("profileForTextKey", () => {
  it.each([
    ["menus.shop.elements.btn.default.lore", false, "lore"],
    ["menus.m.lore", false, "lore"],
    ["menus.shop.title", false, "container-title"],
    ["menus.shop.elements.btn.default.title", false, "item-name"],
    ["menus.m1.elements.e1.default.click.left.show_title.title", false, "title"],
    ["menus.shop.elements.btn.default.click.left.show_subtitle", false, "title"],
    ["menus.shop.elements.btn.default.click.left.message", false, "text-line"],
    ["menus.shop.elements.btn.default.click.left.message", true, "chat"],
  ])("%s → %s", (key, multiline, id) => {
    expect(profileForTextKey(key, multiline).id).toBe(id);
  });

  it("offers no hover action on a lore or a menu title", () => {
    expect(profileForTextKey("menus.m.lore", false).features.has("hover")).toBe(false);
    expect(profileForTextKey("menus.m.title", false).features.has("hover")).toBe(false);
  });
});
