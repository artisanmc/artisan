import { describe, expect, it } from "vitest";
import type { Action, Condition, Element, Menu, OpenProjects, Project } from "./types";

describe("domain types — compile-time shape", () => {
  it("the open Projects compose Projects", () => {
    const openProjects: OpenProjects = {
      projects: [],
      projectOrder: [],
    };
    expect(openProjects.projects).toHaveLength(0);
  });

  it("an open_menu Action carries a MenuId", () => {
    const a: Action = { name: "open_menu", value: "m_1" as Menu["id"] };
    expect(a.name).toBe("open_menu");
  });

  it("an Element holds a display and its states", () => {
    const el: Element = {
      id: "el_1" as Element["id"],
      positions: "0",
      display: { material: "DIAMOND" },
      states: [],
    };
    expect(el.display.material).toBe("DIAMOND");
    expect(el.states).toHaveLength(0);
  });

  it("a Project carries i18n keys scoped to itself", () => {
    const project: Project = {
      id: "p_1" as Project["id"],
      name: "Personal",
      source: "user_created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
      dataSources: [],
      importedConnectors: [],
      i18nKeys: { greeting: { en: "Hi" } } as Project["i18nKeys"],
      defaultLang: "en",
      canvasLayout: {},
    };
    expect(project.defaultLang).toBe("en");
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
    const a: Action = { name: "set_arg", value: { arg: "current_tag", value: `"weapon"` } };
    expect(a.name).toBe("set_arg");
  });

  it("constructs set_arg_cycle_next", () => {
    const a: Action = {
      name: "set_arg_cycle_next",
      value: { arg: "current_tag", list: "categories" },
    };
    expect(a.name).toBe("set_arg_cycle_next");
  });

  it("constructs set_arg_cycle_prev", () => {
    const a: Action = {
      name: "set_arg_cycle_prev",
      value: { arg: "current_tag", list: "categories" },
    };
    expect(a.name).toBe("set_arg_cycle_prev");
  });
});
