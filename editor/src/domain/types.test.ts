import { describe, expect, it } from "vitest";
import type { Account, Action, Condition, Element, Menu, Project } from "./types";

describe("domain types — compile-time shape", () => {
  it("an Account composes Projects", () => {
    const account: Account = {
      id: "acc_1" as Account["id"],
      projects: [],
      projectOrder: [],
    };
    expect(account.projects).toHaveLength(0);
  });

  it("an open_menu Action carries a MenuId", () => {
    const a: Action = { type: "open_menu", menuId: "m_1" as Menu["id"] };
    expect(a.type).toBe("open_menu");
  });

  it("an Element holds appearances", () => {
    const el: Element = {
      id: "el_1" as Element["id"],
      positions: "0",
      appearances: [{ material: "DIAMOND" }],
    };
    expect(el.appearances).toHaveLength(1);
  });

  it("a Project carries i18n keys scoped to itself", () => {
    const pack: Project = {
      id: "p_1" as Project["id"],
      name: "Personal",
      source: "user_created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      menus: [],
      commands: [],
      assets: [],
      dataSources: [],
      dialogs: [],
      importedConnectors: [],
      i18nKeys: { greeting: { en: "Hi" } } as Project["i18nKeys"],
      defaultLang: "en",
      canvasLayout: {},
    };
    expect(pack.defaultLang).toBe("en");
  });
});

describe("Condition union — expression variant", () => {
  it("allows construction of expression conditions", () => {
    const c: Condition = { type: "expression", expr: "quest.gold > 1000" };
    expect(c.type).toBe("expression");
    if (c.type === "expression") {
      expect(c.expr).toBe("quest.gold > 1000");
    }
  });
});

describe("Action union — context mutation variants", () => {
  it("constructs set_arg", () => {
    const a: Action = { type: "set_arg", arg: "current_tag", value: `"weapon"` };
    expect(a.type).toBe("set_arg");
  });

  it("constructs set_arg_cycle_next", () => {
    const a: Action = {
      type: "set_arg_cycle_next",
      arg: "current_tag",
      list: "categories",
    };
    expect(a.type).toBe("set_arg_cycle_next");
  });

  it("constructs set_arg_cycle_prev", () => {
    const a: Action = {
      type: "set_arg_cycle_prev",
      arg: "current_tag",
      list: "categories",
    };
    expect(a.type).toBe("set_arg_cycle_prev");
  });
});
