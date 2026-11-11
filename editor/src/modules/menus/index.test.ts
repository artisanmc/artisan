import { describe, expect, it } from "vitest";
import { menusModule } from "./index";

describe("menusModule (editor)", () => {
  it("has id 'menus'", () => {
    expect(menusModule.id).toBe("menus");
  });

  it("declares a sidebar entry pointing to the home page", () => {
    expect(menusModule.sidebar.label).toMatch(/menu/i);
    expect(menusModule.sidebar.to).toBe("/");
  });
});
