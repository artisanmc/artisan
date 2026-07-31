import { describe, expect, it } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { buildProjectDocuments } from "./useProjectDocuments";

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
    // title is an LText ref — key "k_d1" resolved via i18nKeys below
    dialogs: [{ id: "d1", projectId: PID, title: { key: "k_d1" }, canCloseWithEscape: true, body: [], inputs: [], buttons: [] } as any],
    assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: { k_d1: { en: "Confirm" } } as any,
    defaultLang: "en", canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Project;
}

describe("buildProjectDocuments", () => {
  it("groupe par catégorie avec id, label, type et flag onBoard", () => {
    const groups = buildProjectDocuments(project(), "en");
    const menus = groups.find((g) => g.type === "menu")!;
    expect(menus.items[0]).toMatchObject({ id: "m1", onBoard: true, type: "menu" });
    const cmds = groups.find((g) => g.type === "command")!;
    expect(cmds.items[0]).toMatchObject({ id: "c1", label: "/heal", onBoard: false });
    const dlgs = groups.find((g) => g.type === "dialog")!;
    expect(dlgs.items[0]).toMatchObject({ id: "d1", onBoard: false });
    // dialog label resolves title via i18nKeys, not raw id
    expect(dlgs.items[0].label).toBe("Confirm");
  });

  it("menu label is always the id, even when the menu has a title", () => {
    const p = project();
    // Give the menu a resolvable text title; the panel must STILL show the id.
    (p.menus as any)[0].title = [{ kind: "text", value: { key: "k_m1" } }];
    (p.i18nKeys as any).k_m1 = { en: "Shop" };
    const groups = buildProjectDocuments(p, "en");
    const menus = groups.find((g) => g.type === "menu")!;
    expect(menus.items[0].label).toBe("m1");
  });

  it("dialog label falls back to id when title has no matching key", () => {
    const p = project();
    // Remove the i18nKeys entry so getText returns ""
    (p.i18nKeys as any) = {};
    const groups = buildProjectDocuments(p, "en");
    const dlgs = groups.find((g) => g.type === "dialog")!;
    expect(dlgs.items[0].label).toBe("d1");
  });
});
