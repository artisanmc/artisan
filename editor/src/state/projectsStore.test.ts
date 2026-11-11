import { commandsOf, dialogsOf, menusOf } from "@/domain/documents";
import { commandId, dialogId, elementId, menuId, projectId } from "@/domain/ids";
import type { I18nKey, MenuTitleLayer } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { produce } from "immer";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectDraftStore } from "./projectDraftStore";
import { useProjectsStore } from "./projectsStore";

const PERSONAL = projectId("p_personal");
const SHOP_MAIN = menuId("m_shop_main");
const PROFILE_BTN = elementId("el_btn_profile");

const findElement = (mId = SHOP_MAIN, eId = PROFILE_BTN) => {
  const project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
  const menu = menusOf(project).find((m) => m.id === mId)!;
  return menu.layers[0]!.elements.find((el) => el.id === eId);
};

describe("projectsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
  });

  describe("menu item sets", () => {
    const getProject = () =>
      useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;

    describe("createMenuSet (menu-level item set — no template)", () => {
      const SCHEMA = [{ name: "id" }, { name: "name" }, { name: "icon" }, { name: "price" }];
      const setupMenu = () => {
        const mId = useProjectsStore.getState().createMenu({ projectId: PERSONAL, id: "m_set" });
        useProjectsStore.setState((state) =>
          produce(state, (draft) => {
            const menu = menusOf(draft.openProjects.projects.find((p) => p.id === PERSONAL)!).find(
              (m) => m.id === mId,
            )!;
            menu.contextInputs = [
              { kind: "sourceRef", name: "items", ref: "boutique:items" as never },
            ];
          }),
        );
        return mId;
      };

      it("paginated mode: creates a self-contained iterating element with a seeded display", () => {
        const mId = setupMenu();
        const r = useProjectsStore.getState().createMenuSet({
          projectId: PERSONAL,
          menuId: mId,
          inputName: "items",
          mode: "iterates",
          keyField: "id",
          schema: SCHEMA,
        });
        expect(r.ok).toBe(true);
        const project = getProject();
        const menu = menusOf(project).find((m) => m.id === mId)!;
        const el = menu.layers.flatMap((l) => l.elements).find((e) => e.iterates)!;
        expect(el.iterates).toEqual({ source: "items", alias: "item" }); // NO templateId
        expect(el.positions).not.toBe("");
        // Seeded from the schema heuristics: icon → material, name → title, price → lore.
        expect(el.display!.material).toBe("{item.icon}");
        const titleKey = el.display!.title!.key;
        expect(project.i18nKeys[titleKey as never]).toEqual({ en: "{item.name}" });
        const loreKey = el.display!.lore!.key;
        expect(project.i18nKeys[loreKey as never]).toEqual({ en: "{item.price}" });
      });

      it("placement mode: creates an empty-placements element keyed on keyField", () => {
        const mId = setupMenu();
        const r = useProjectsStore.getState().createMenuSet({
          projectId: PERSONAL,
          menuId: mId,
          inputName: "items",
          mode: "places",
          keyField: "id",
          schema: SCHEMA,
        });
        expect(r.ok).toBe(true);
        const el = menusOf(getProject())
          .find((m) => m.id === mId)!
          .layers.flatMap((l) => l.elements)
          .find((e) => e.places)!;
        expect(el.places).toEqual({
          source: "items",
          alias: "item",
          keyField: "id",
          placements: [],
        });
        expect(el.positions).toBe("");
        expect(el.display!.material).toBe("{item.icon}");
      });

      it("refuses a second set on the same menu list", () => {
        const mId = setupMenu();
        useProjectsStore.getState().createMenuSet({
          projectId: PERSONAL,
          menuId: mId,
          inputName: "items",
          mode: "iterates",
          keyField: "id",
          schema: SCHEMA,
        });
        const r2 = useProjectsStore.getState().createMenuSet({
          projectId: PERSONAL,
          menuId: mId,
          inputName: "items",
          mode: "places",
          keyField: "id",
          schema: SCHEMA,
        });
        expect(r2).toEqual({ ok: false, reason: "already_exists" });
      });
    });

    it("addCapturedItem appends (init array) and removeCapturedItem drops by id", () => {
      const item = {
        id: "ci_key" as never,
        name: "Clé Luxury",
        stackYaml: "==: org.bukkit.inventory.ItemStack\n",
        display: { material: "nexo:arcanist_key", enchanted: true },
      };
      useProjectsStore.getState().addCapturedItem({ projectId: PERSONAL, item });
      expect(getProject().capturedItems).toEqual([item]);
      // Same id re-captured → replaced, not duplicated.
      useProjectsStore.getState().addCapturedItem({
        projectId: PERSONAL,
        item: { ...item, name: "Clé Luxury v2" },
      });
      expect(getProject().capturedItems).toHaveLength(1);
      expect(getProject().capturedItems![0]!.name).toBe("Clé Luxury v2");

      useProjectsStore
        .getState()
        .removeCapturedItem({ projectId: PERSONAL, itemId: "ci_key" as never });
      expect(getProject().capturedItems).toHaveLength(0);
    });
  });

  it("createDialog returns a DialogId and adds dialog to project", () => {
    const dId = useProjectsStore.getState().createDialog({
      projectId: PERSONAL,
      id: "d_test",
    });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(dialogsOf(project)).toHaveLength(1);
    expect(dialogsOf(project)[0]!.id).toBe("d_test");
    expect(typeof dId).toBe("string");
  });

  it("createDialog with position sets canvasLayout", () => {
    useProjectsStore.getState().createDialog({
      projectId: PERSONAL,
      id: "d_shop",
      position: { x: 100, y: 200 },
    });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect((project.canvasLayout as Record<string, unknown>)["dialog/d_shop"]).toEqual({
      x: 100,
      y: 200,
    });
  });

  describe("placement mode reducers", () => {
    const places = () => useProjectsStore.getState().setElementPlaces;
    const base = { projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN };

    it("setElementPlaces sets the binding and clears iterates (XOR)", () => {
      useProjectsStore
        .getState()
        .setElementIterates({ ...base, iterates: { source: "items", alias: "item" } });
      expect(findElement()!.iterates).toBeDefined();
      places()({
        ...base,
        places: { source: "items", alias: "item", keyField: "id", placements: [] },
      });
      expect(findElement()!.places?.keyField).toBe("id");
      expect(findElement()!.iterates).toBeUndefined();
    });

    it("setElementIterates clears a prior places binding (XOR both ways)", () => {
      places()({
        ...base,
        places: { source: "items", alias: "item", keyField: "id", placements: [] },
      });
      useProjectsStore
        .getState()
        .setElementIterates({ ...base, iterates: { source: "items", alias: "item" } });
      expect(findElement()!.places).toBeUndefined();
      expect(findElement()!.iterates).toBeDefined();
    });

    it("setElementPlacement upserts by key; removeElementPlacement removes", () => {
      places()({
        ...base,
        places: { source: "items", alias: "item", keyField: "id", placements: [] },
      });
      useProjectsStore
        .getState()
        .setElementPlacement({ ...base, placement: { key: "sword", page: 0, position: 10 } });
      useProjectsStore
        .getState()
        .setElementPlacement({ ...base, placement: { key: "sword", page: 0, position: 14 } }); // move
      useProjectsStore
        .getState()
        .setElementPlacement({ ...base, placement: { key: "apple", page: 1, position: 3 } });
      expect(findElement()!.places!.placements).toEqual([
        { key: "sword", page: 0, position: 14 },
        { key: "apple", page: 1, position: 3 },
      ]);
      useProjectsStore.getState().removeElementPlacement({ ...base, key: "sword" });
      expect(findElement()!.places!.placements).toEqual([{ key: "apple", page: 1, position: 3 }]);
    });
  });

  it("setDialogTitle stores translation in i18nKeys", () => {
    useProjectsStore.getState().createDialog({ projectId: PERSONAL, id: "d_greet" });
    useProjectsStore.getState().setDialogTitle({
      projectId: PERSONAL,
      dialogId: dialogId("d_greet"),
      lang: "en",
      value: "Hello!",
    });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    const dialog = dialogsOf(project).find((d) => d.id === "d_greet")!;
    expect(project.i18nKeys[dialog.title.key]!.en).toBe("Hello!");
  });

  it("removeUnusedI18nKeys drops orphaned keys but keeps referenced ones and add-on messages", () => {
    const store = useProjectsStore.getState();
    // Seed an orphan: setI18nValue against a key no tree node references.
    store.setI18nValue({
      projectId: PERSONAL,
      lt: { key: "lt_orphan_xyz" as I18nKey },
      lang: "en",
      value: "stale",
    });
    const usedKey = "menus.m_shop_main.title" as I18nKey; // referenced by the fixture menu title
    // Read by an add-on's code (`send_message @auctions.messages.no_item`), held by no document.
    const moduleKey = "auctions.messages.no_item" as I18nKey;
    store.setI18nValue({
      projectId: PERSONAL,
      lt: { key: moduleKey },
      lang: "en",
      value: "Hold it",
    });
    let project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(project.i18nKeys["lt_orphan_xyz" as I18nKey]).toBeTruthy();
    expect(project.i18nKeys[usedKey]).toBeTruthy();

    store.removeUnusedI18nKeys({ projectId: PERSONAL });

    project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(project.i18nKeys["lt_orphan_xyz" as I18nKey]).toBeUndefined();
    expect(project.i18nKeys[usedKey]).toBeTruthy();
    expect(project.i18nKeys[moduleKey]).toBeTruthy();
  });

  it("deleteFromProject removes dialog and its canvas position", () => {
    useProjectsStore
      .getState()
      .createDialog({ projectId: PERSONAL, id: "d_bye", position: { x: 10, y: 10 } });
    useProjectsStore
      .getState()
      .deleteFromProject({ projectId: PERSONAL, nodeIds: ["dialog/d_bye"] });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(dialogsOf(project).some((d) => d.id === "d_bye")).toBe(false);
    expect((project.canvasLayout as Record<string, unknown>)["dialog/d_bye"]).toBeUndefined();
  });

  it("setEdgeAnchor stores an endpoint override; clearEdgeAnchor removes it and the empty entry", () => {
    useProjectsStore.getState().setEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "m_shop_main->m_profile",
      end: "from",
      anchor: { side: "top", t: 0.3 },
    });
    let project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(project.canvasEdges!["m_shop_main->m_profile"]).toEqual({
      from: { side: "top", t: 0.3 },
    });

    useProjectsStore.getState().clearEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "m_shop_main->m_profile",
      end: "from",
    });
    project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(project.canvasEdges?.["m_shop_main->m_profile"]).toBeUndefined();
  });

  it("deleteFromProject prunes canvasEdges entries touching the deleted node", () => {
    useProjectsStore.getState().setEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "menu/m_shop_main->menu/m_about",
      end: "to",
      anchor: { side: "left", t: 0.5 },
    });
    useProjectsStore
      .getState()
      .deleteFromProject({ projectId: PERSONAL, nodeIds: ["menu/m_about"] });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(project.canvasEdges?.["menu/m_shop_main->menu/m_about"]).toBeUndefined();
  });

  it("setMenuId rewrites canvasEdges keys", () => {
    useProjectsStore.getState().setEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "menu/m_shop_main->menu/m_profile",
      end: "from",
      anchor: { side: "bottom", t: 0.8 },
    });
    useProjectsStore.getState().setMenuId({
      projectId: PERSONAL,
      oldId: menuId("m_profile"),
      newId: menuId("m_profile2"),
    });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    expect(project.canvasEdges?.["menu/m_shop_main->menu/m_profile"]).toBeUndefined();
    expect(project.canvasEdges?.["menu/m_shop_main->menu/m_profile2"]).toEqual({
      from: { side: "bottom", t: 0.8 },
    });
  });

  it("addDialogButton appends a button with LText", () => {
    useProjectsStore.getState().createDialog({ projectId: PERSONAL, id: "d_multi" });
    useProjectsStore
      .getState()
      .addDialogButton({ projectId: PERSONAL, dialogId: dialogId("d_multi") });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    const d = dialogsOf(project).find((d) => d.id === "d_multi")!;
    expect(d.buttons).toHaveLength(2); // default btn_confirm + new one
  });

  it("starts with the seed projects", () => {
    expect(useProjectsStore.getState().openProjects.projects).toHaveLength(3);
  });

  describe("moduleData", () => {
    it("setModuleData writes the module's namespace and preserves others", () => {
      useProjectsStore.getState().setModuleData(PERSONAL, "boutique", { categories: [] });
      useProjectsStore.getState().setModuleData(PERSONAL, "quests", { chains: 1 });
      const p = useProjectsStore.getState().openProjects.projects.find((x) => x.id === PERSONAL)!;
      expect(p.moduleData?.boutique).toEqual({ categories: [] });
      expect(p.moduleData?.quests).toEqual({ chains: 1 });
    });

    it("importProject preserves moduleData", () => {
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const id = useProjectsStore.getState().importProject({
        project: { ...source, moduleData: { boutique: { categories: [] } } },
      });
      const imported = useProjectsStore.getState().openProjects.projects.find((p) => p.id === id)!;
      expect(imported.moduleData?.boutique).toEqual({ categories: [] });
    });
  });

  it("createProject appends to projects and projectOrder", () => {
    useProjectsStore.getState().createProject({ id: "new_pack" });
    const a = useProjectsStore.getState().openProjects;
    expect(a.projects).toHaveLength(4);
    expect(a.projectOrder).toHaveLength(4);
    expect(a.projects[3]!.name).toBe("new_pack");
  });

  it("reorderProjects rewrites projectOrder", () => {
    const original = useProjectsStore.getState().openProjects.projectOrder;
    const reversed = [...original].reverse();
    useProjectsStore.getState().reorderProjects(reversed);
    expect(useProjectsStore.getState().openProjects.projectOrder).toEqual(reversed);
  });

  it("moveMenuToProject moves the menu across projects", () => {
    const fromId = projectId("p_personal");
    const toId = projectId("p_shop_system");
    const menuToMove = menuId("m_about");

    useProjectsStore
      .getState()
      .moveMenuToProject({ menuId: menuToMove, fromProjectId: fromId, toProjectId: toId });

    const a = useProjectsStore.getState().openProjects;
    const from = a.projects.find((p) => p.id === fromId)!;
    const to = a.projects.find((p) => p.id === toId)!;
    expect(menusOf(from).some((m) => m.id === menuToMove)).toBe(false);
    expect(menusOf(to).some((m) => m.id === menuToMove)).toBe(true);
    expect(menusOf(to).find((m) => m.id === menuToMove)!.projectId).toBe(toId);
  });

  it("moveMenuToProject succeeds even when refs become dangling", () => {
    // m_shop_main has open_menu actions targeting menus in p_personal.
    // We no longer enforce hermeticity — the runtime is responsible for
    // tolerating missing targets — so the move just goes through.
    const fromId = projectId("p_personal");
    const toId = projectId("p_shop_system");
    const sourceMenu = menuId("m_shop_main");

    useProjectsStore
      .getState()
      .moveMenuToProject({ menuId: sourceMenu, fromProjectId: fromId, toProjectId: toId });

    const a = useProjectsStore.getState().openProjects;
    expect(menusOf(a.projects.find((p) => p.id === fromId)!).some((m) => m.id === sourceMenu)).toBe(
      false,
    );
    expect(menusOf(a.projects.find((p) => p.id === toId)!).some((m) => m.id === sourceMenu)).toBe(
      true,
    );
  });

  it("deleteFromProject removes a leaf menu and its canvas position", () => {
    const pId = projectId("p_personal");
    useProjectsStore.getState().deleteFromProject({ projectId: pId, nodeIds: ["menu/m_about"] });
    const project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!;
    expect(menusOf(project).some((m) => m.id === "m_about")).toBe(false);
    expect("menu/m_about" in project.canvasLayout).toBe(false);
  });

  it("deleteFromProject succeeds even when the menu has inbound refs", () => {
    // m_profile is referenced by m_shop_main's actions. Deleting it leaves
    // those refs dangling — that's fine; the runtime no-ops on missing
    // open_menu targets.
    const pId = projectId("p_personal");
    useProjectsStore.getState().deleteFromProject({ projectId: pId, nodeIds: ["menu/m_profile"] });
    const project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!;
    expect(menusOf(project).some((m) => m.id === "m_profile")).toBe(false);
  });

  it("setSlotMaterial updates an existing element at that position", () => {
    useProjectsStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "DIAMOND",
    });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === projectId("p_personal"))!;
    const menu = menusOf(project).find((m) => m.id === "m_shop_main")!;
    const el = menu.layers[0]!.elements.find((e) => e.positions === "13")!;
    expect(el.display!.material).toBe("DIAMOND");
  });

  it("setSlotMaterial creates an element at an empty position", () => {
    useProjectsStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_about"),
      position: 5,
      material: "PAPER",
    });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === projectId("p_personal"))!;
    const menu = menusOf(project).find((m) => m.id === "m_about")!;
    const el = menu.layers[0]!.elements.find((e) => e.positions === "5");
    expect(el?.display?.material).toBe("PAPER");
  });

  it("setSlotMaterial uses material-based IDs (paper_1, paper_2, …)", () => {
    const pId = projectId("p_personal");
    const mId = menuId("m_about");
    useProjectsStore
      .getState()
      .setSlotMaterial({ projectId: pId, menuId: mId, position: 5, material: "PAPER" });
    useProjectsStore
      .getState()
      .setSlotMaterial({ projectId: pId, menuId: mId, position: 6, material: "PAPER" });
    useProjectsStore
      .getState()
      .setSlotMaterial({ projectId: pId, menuId: mId, position: 7, material: "DIRT" });
    const menu = menusOf(
      useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
    ).find((m) => m.id === mId)!;
    const ids = menu.layers[0]!.elements.map((e) => e.id);
    expect(ids).toContain("paper_1");
    expect(ids).toContain("paper_2");
    expect(ids).toContain("dirt_1");
  });

  it("temporal.undo reverts a slot material change", () => {
    useProjectsStore.temporal.getState().clear();
    useProjectsStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "EMERALD",
    });
    expect(
      menusOf(useProjectsStore.getState().openProjects.projects.find((p) => p.id === "p_personal")!)
        .find((m) => m.id === "m_shop_main")!
        .layers[0]!.elements.find((e) => e.positions === "13")?.display?.material,
    ).toBe("EMERALD");

    useProjectsStore.temporal.getState().undo();

    expect(
      menusOf(useProjectsStore.getState().openProjects.projects.find((p) => p.id === "p_personal")!)
        .find((m) => m.id === "m_shop_main")!
        .layers[0]!.elements.find((e) => e.positions === "13")?.display?.material,
    ).not.toBe("EMERALD");
  });

  it("setElementPositions replaces the element's positions string", () => {
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-2,13",
    });
    expect(findElement()?.positions).toBe("0-2,13");
  });

  it("addElementPosition (Alt+drag duplicate) extends the positions list", () => {
    useProjectsStore.getState().addElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      position: 14,
    });
    expect(findElement()?.positions).toBe("13-14");
  });

  it("addElementPosition steals the slot from another element", () => {
    // Seed a second element at position 22, then duplicate the profile button onto it.
    useProjectsStore.getState().setSlotMaterial({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      position: 22,
      material: "DIRT",
    });
    useProjectsStore.getState().addElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      position: 22,
    });
    expect(findElement()?.positions).toBe("13,22");
    // The DIRT element lost its only position and was pruned entirely.
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    const menu = menusOf(project).find((m) => m.id === SHOP_MAIN)!;
    const dirt = menu.layers[0]!.elements.find((el) => el.display?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("moveElementPosition relocates a single position", () => {
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "13",
    });
    useProjectsStore.getState().moveElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      fromPosition: 13,
      toPosition: 4,
    });
    expect(findElement()?.positions).toBe("4");
  });

  it("moveElementPosition keeps multi-pos elements in sync", () => {
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-2",
    });
    useProjectsStore.getState().moveElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      fromPosition: 1,
      toPosition: 5,
    });
    expect(findElement()?.positions).toBe("0,2,5");
  });

  it("clearSlot on a multi-pos element removes only that position", () => {
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-3",
    });
    useProjectsStore.getState().clearSlot({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 1 });
    expect(findElement()?.positions).toBe("0,2-3");
  });

  it("clearSlot deletes the element when its last position goes", () => {
    useProjectsStore.getState().clearSlot({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 13 });
    expect(findElement()).toBeUndefined();
  });

  it("deleteElement removes the entire element regardless of position count", () => {
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-8",
    });
    useProjectsStore.getState().deleteElement({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
    });
    expect(findElement()).toBeUndefined();
  });

  it("addElement inserts a new element and strips conflicting positions from siblings", () => {
    // Seed a sibling element at position 5
    useProjectsStore
      .getState()
      .setSlotMaterial({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 5, material: "DIRT" });
    useProjectsStore.getState().addElement({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      element: {
        id: elementId("el_pasted"),
        positions: "5,6",
        display: { material: "GOLD_INGOT" },
        states: [],
      },
    });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    const menu = menusOf(project).find((m) => m.id === SHOP_MAIN)!;
    // addElement now renames the id following the material_N scheme (paste-friendly).
    const pasted = menu.layers[0]!.elements.find((el) => el.display?.material === "GOLD_INGOT");
    expect(pasted?.id).toMatch(/^gold_ingot_\d+$/);
    expect(pasted?.positions).toBe("5-6");
    // The DIRT element lost its only position and was pruned.
    const dirt = menu.layers[0]!.elements.find((el) => el.display?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("addElement clones i18n keys so original and duplicate are independent", () => {
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    const menu = menusOf(project).find((m) => m.id === SHOP_MAIN)!;
    const original = menu.layers[0]!.elements.find((el) => el.id === PROFILE_BTN)!;
    const originalTitleKey = original.display!.title?.key;
    if (!originalTitleKey) throw new Error("fixture missing title");

    // Simulate a clipboard paste: element with new ID but same LText key as the original.
    useProjectsStore.getState().addElement({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      element: {
        id: elementId("el_pasted_clone"),
        positions: "20",
        display: { ...original.display! },
        states: [],
      },
    });

    const state = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
    const stateMenu = menusOf(state).find((m) => m.id === SHOP_MAIN)!;
    // addElement renumbers the id by material; locate the just-added element
    // by its new positions instead of the now-overwritten input id.
    const pasted = stateMenu.layers[0]!.elements.find((el) => el.positions === "20")!;
    const pastedTitleKey = pasted.display!.title?.key;

    // Pasted element must have a different key.
    expect(pastedTitleKey).toBeDefined();
    expect(pastedTitleKey).not.toBe(originalTitleKey);
    // Both keys must exist in i18nKeys with the same value.
    expect(state.i18nKeys[originalTitleKey as I18nKey]).toBeDefined();
    expect(state.i18nKeys[pastedTitleKey as I18nKey]).toEqual(
      state.i18nKeys[originalTitleKey as I18nKey],
    );
  });

  it("moveSelectionByDelta shifts every selected element by (dCol, dRow)", () => {
    // m_shop_main has rows=3 → row indices 0..2.
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0,1",
    });
    useProjectsStore
      .getState()
      .setSlotMaterial({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 9, material: "STONE" });
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    const menu = menusOf(project).find((m) => m.id === SHOP_MAIN)!;
    const stoneId = menu.layers[0]!.elements.find((el) => el.display?.material === "STONE")!.id;

    useProjectsStore.getState().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN, stoneId],
      dCol: 1,
      dRow: 1,
    });

    expect(findElement()?.positions).toBe("10-11");
    const stoneAfter = menusOf(
      useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!,
    )
      .find((m) => m.id === SHOP_MAIN)!
      .layers[0]!.elements.find((el) => el.id === stoneId);
    expect(stoneAfter?.positions).toBe("19");
  });

  it("moveSelectionByDelta strips claimed positions from non-target elements", () => {
    // PROFILE_BTN at 13. Add another element at 14, then drag PROFILE_BTN by +1
    useProjectsStore
      .getState()
      .setSlotMaterial({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 14, material: "DIRT" });
    useProjectsStore.getState().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN],
      dCol: 1,
      dRow: 0,
    });
    expect(findElement()?.positions).toBe("14");
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL)!;
    const menu = menusOf(project).find((m) => m.id === SHOP_MAIN)!;
    const dirt = menu.layers[0]!.elements.find((el) => el.display?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("moveSelectionByDelta throws when the move goes out of bounds", () => {
    expect(() =>
      useProjectsStore.getState().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementIds: [PROFILE_BTN],
        dCol: 0,
        dRow: 99,
      }),
    ).toThrow(/outside the menu/);
    // Source unchanged.
    expect(findElement()?.positions).toBe("13");
  });

  it("moveSelectionByDelta respects the inventory type's grid (hopper = 5 cols × 1 row)", () => {
    // Turn SHOP_MAIN into a hopper: 5 columns, a single row.
    useProjectsStore.getState().setMenuField({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      field: "inventoryType",
      value: "hopper",
    });

    // Last hopper column is 4; moving right leaves the 5-wide grid → must throw
    // (a chest-assuming `% 9` would wrongly allow it and produce slot 5).
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "4",
    });
    expect(() =>
      useProjectsStore.getState().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementIds: [PROFILE_BTN],
        dCol: 1,
        dRow: 0,
      }),
    ).toThrow(/outside the menu/);
    expect(findElement()?.positions).toBe("4");

    // A hopper has a single row; moving down must throw (chest `menu.rows` bound
    // would wrongly allow it and produce slot 9).
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0",
    });
    expect(() =>
      useProjectsStore.getState().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementIds: [PROFILE_BTN],
        dCol: 0,
        dRow: 1,
      }),
    ).toThrow(/outside the menu/);

    // A valid in-row move still works: col 1 → col 2.
    useProjectsStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "1",
    });
    useProjectsStore.getState().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN],
      dCol: 1,
      dRow: 0,
    });
    expect(findElement()?.positions).toBe("2");
  });

  it("addAppearance pushes a conditional state seeded with a placeholder permission", () => {
    useProjectsStore
      .getState()
      .addAppearance({ projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN });
    const el = findElement()!;
    expect(el.states).toHaveLength(1);
    const seeded = el.states[0]!;
    expect(seeded.if?.[0]?.type).toBe("has_permission");
  });

  it("removeAppearance drops a state and never touches the display", () => {
    // Add a state, then remove it.
    useProjectsStore
      .getState()
      .addAppearance({ projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN });
    useProjectsStore.getState().removeAppearance({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 1,
    });
    expect(findElement()!.states).toHaveLength(0);
    // Index 0 is the display — an Element always has one, so removing it is a no-op.
    useProjectsStore.getState().removeAppearance({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
    });
    expect(findElement()!.display).toBeDefined();
    expect(findElement()!.states).toHaveLength(0);
  });

  it("addElementClickHandler creates an empty handler at clickType, removeElementClickHandler clears it", () => {
    useProjectsStore.getState().addElementClickHandler({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "right",
    });
    expect(findElement()!.display?.click?.right?.steps).toEqual([]);
    useProjectsStore.getState().removeElementClickHandler({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "right",
    });
    expect(findElement()!.display?.click?.right).toBeUndefined();
  });

  it("addElementStep appends and removeElementStep drops by path", () => {
    useProjectsStore.getState().addElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      index: -1,
      step: { kind: "action", action: { name: "close_menu", value: null } },
      lang: "en",
    });
    let steps = findElement()!.display!.click!.left!.steps;
    expect(steps).toHaveLength(2);
    expect(steps[1]?.kind).toBe("action");
    useProjectsStore.getState().removeElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      path: { frames: [], index: 1 },
    });
    steps = findElement()!.display!.click!.left!.steps;
    expect(steps).toHaveLength(1);
  });

  it("moveElementStep reorders steps within a chain", () => {
    useProjectsStore.getState().addElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      index: -1,
      step: {
        kind: "action",
        action: { name: "send_message", value: { key: "" as I18nKey } },
      },
      lang: "en",
    });
    useProjectsStore.getState().moveElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      from: { frames: [], index: 1 },
      to: { frames: [], index: 0 },
    });
    const steps = findElement()!.display!.click!.left!.steps;
    expect(steps[0]?.kind === "action" && steps[0].action.name).toBe("send_message");
    expect(steps[1]?.kind === "action" && steps[1].action.name).toBe("open_menu");
  });

  it("addElementStep into an if-step's case descends through the path", () => {
    // Replace the existing chain with an if-step.
    useProjectsStore.getState().setElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      path: { frames: [], index: 0 },
      step: { kind: "if", cases: [{ conditions: [], steps: [] }] },
      lang: "en",
    });
    useProjectsStore.getState().addElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [{ stepIndex: 0, descend: { case: 0 } }],
      index: 0,
      step: { kind: "action", action: { name: "close_menu", value: null } },
      lang: "en",
    });
    const root = findElement()!.display!.click!.left!.steps[0]!;
    if (root.kind !== "if") throw new Error("expected if");
    expect(root.cases[0]!.steps).toHaveLength(1);
    expect(root.cases[0]!.steps[0]?.kind).toBe("action");
  });

  describe("command arg order validation", () => {
    const pId = projectId("p_personal");

    it("addCommandArg throws when appending required after optional", () => {
      const cId = useProjectsStore.getState().createCommand({ projectId: pId });
      useProjectsStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      expect(() =>
        useProjectsStore.getState().addCommandArg({
          projectId: pId,
          commandId: cId,
          arg: { name: "req", type: "string", required: true },
        }),
      ).toThrow(/cannot follow/);
    });

    it("setCommandArg throws when making an arg required after an optional one", () => {
      const cId = useProjectsStore.getState().createCommand({ projectId: pId });
      useProjectsStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      useProjectsStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "second", type: "string", required: false },
      });
      expect(() =>
        useProjectsStore.getState().setCommandArg({
          projectId: pId,
          commandId: cId,
          index: 1,
          arg: { name: "second", type: "string", required: true },
        }),
      ).toThrow(/cannot follow/);
    });

    it("valid order (required then optional) succeeds", () => {
      const cId = useProjectsStore.getState().createCommand({ projectId: pId });
      useProjectsStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "target", type: "player", required: true },
      });
      useProjectsStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "amount", type: "integer", required: false },
      });
      const cmd = commandsOf(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
      ).find((c) => c.id === cId)!;
      expect(cmd.arguments).toHaveLength(2);
      expect(cmd.arguments[0]!.required).toBe(true);
      expect(cmd.arguments[1]!.required).toBe(false);
    });

    it("state is unchanged when validation throws", () => {
      const cId = useProjectsStore.getState().createCommand({ projectId: pId });
      useProjectsStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      try {
        useProjectsStore.getState().addCommandArg({
          projectId: pId,
          commandId: cId,
          arg: { name: "req", type: "string", required: true },
        });
      } catch {
        // expected
      }
      const cmd = commandsOf(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
      ).find((c) => c.id === cId)!;
      expect(cmd.arguments).toHaveLength(1);
    });
  });

  describe("menu contextInput discriminated union", () => {
    it("addMenuContextInput with kind='primitive' adds a primitive input", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useProjectsStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "primitive",
      });
      const menu = menusOf(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
      ).find((m) => m.id === mId)!;
      const added = (menu.contextInputs ?? []).at(-1);
      expect(added?.kind).toBe("primitive");
      if (added?.kind === "primitive") {
        expect(added.type).toBe("string");
      }
    });

    it("addMenuContextInput with kind='sourceRef' adds a sourceRef input", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useProjectsStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "sourceRef",
      });
      const menu = menusOf(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
      ).find((m) => m.id === mId)!;
      const added = (menu.contextInputs ?? []).at(-1);
      expect(added?.kind).toBe("sourceRef");
    });

    it("setMenuContextInput persists a sourceRef input", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useProjectsStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "sourceRef",
      });
      const before = menusOf(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
      ).find((m) => m.id === mId)!;
      const idx = (before.contextInputs ?? []).findIndex((c) => c.kind === "sourceRef");
      expect(idx).toBeGreaterThanOrEqual(0);

      useProjectsStore.getState().setMenuContextInput({
        projectId: pId,
        menuId: mId,
        index: idx,
        input: {
          kind: "sourceRef",
          name: "shops",
          ref: "chestshop:items" as import("@/domain/types").SourceRef,
        },
      });

      const after = menusOf(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
      ).find((m) => m.id === mId)!;
      const stored = (after.contextInputs ?? []).find((c) => c.name === "shops");
      expect(stored?.kind).toBe("sourceRef");
      if (stored?.kind === "sourceRef") {
        expect(stored.ref).toBe("chestshop:items");
      }
    });

    it("setMenuContextInput can update a primitive input to a different type", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useProjectsStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "primitive",
      });
      const before = menusOf(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!,
      ).find((m) => m.id === mId)!;
      const idx = (before.contextInputs ?? []).findIndex((c) => c.kind === "primitive");

      useProjectsStore.getState().setMenuContextInput({
        projectId: pId,
        menuId: mId,
        index: idx,
        input: { kind: "primitive", name: "category", type: "player" },
      });

      const stored = (
        menusOf(useProjectsStore.getState().openProjects.projects.find((p) => p.id === pId)!).find(
          (m) => m.id === mId,
        )!.contextInputs ?? []
      ).find((c) => c.name === "category");
      expect(stored?.kind).toBe("primitive");
      if (stored?.kind === "primitive") {
        expect(stored.type).toBe("player");
      }
    });
  });

  describe("DataSource reducers", () => {
    it("adds a table source with its auto-created Data model (Row key seeded)", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect(project.dataSources).toHaveLength(1);
      const ds = project.dataSources[0]!;
      expect(ds.name).toBe("new_source");
      expect(ds.shape).toBe("table");
      if (ds.shape !== "table") throw new Error("expected table");
      expect(ds.rows).toEqual([]);
      const model = project.dataModels!.find((m) => m.id === ds.modelId)!;
      expect(model.name).toBe("new_source");
      expect(model.keyField).toBe("id");
      expect(model.fields).toEqual([{ name: "id", type: { kind: "string" } }]);
    });

    it("adds a config source without a model", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL, shape: "config" });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const ds = project.dataSources[0]!;
      expect(ds.shape).toBe("config");
      if (ds.shape !== "config") throw new Error("expected config");
      expect(ds.fields).toEqual([]);
      expect(ds.value).toEqual({});
      expect(project.dataModels ?? []).toHaveLength(0);
    });

    it("disambiguates duplicate names", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect(project.dataSources[0]!.name).toBe("new_source");
      expect(project.dataSources[1]!.name).toBe("new_source_2");
    });

    it("removes a data source by id and GCs its orphaned auto-model + i18n keys", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const pack0 = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const ds = pack0.dataSources[0]!;
      if (ds.shape !== "table") throw new Error("expected table");
      // Simulate an authored ltext row value backed by an i18n entry.
      useProjectsStore.setState((s) =>
        produce(s, (draft) => {
          const project = draft.openProjects.projects.find((p) => p.id === PERSONAL)!;
          const model = project.dataModels!.find(
            (m) => m.id === (ds as { modelId: unknown }).modelId,
          )!;
          model.fields.push({ name: "label", type: { kind: "ltext" } });
          (project.dataSources[0] as { rows: unknown[] }).rows = [
            { id: "r1", label: { key: "lt_x" } },
          ];
          project.i18nKeys["lt_x" as never] = { en: "Hello" };
        }),
      );
      useProjectsStore.getState().removeProjectDataSource({ projectId: PERSONAL, id: ds.id });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect(project.dataSources).toHaveLength(0);
      expect(project.dataModels).toHaveLength(0);
      expect(project.i18nKeys["lt_x" as never]).toBeUndefined();
    });

    it("row lifecycle: add seeds defaults + mints ltexts, cell set, remove releases keys", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const pack0 = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const ds0 = pack0.dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      // Declare: name (ltext) + icon (item) on the auto model.
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "name", type: { kind: "ltext" } } },
      });
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "icon", type: { kind: "item" } } },
      });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: ds0.id });
      let project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      let row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect(row.id).toBe("row_1");
      expect(row.icon).toBe("");
      const lt = row.name as { key: string };
      // Minted: non-sentinel key backed by an i18n entry.
      expect(lt.key).not.toBe("");
      expect(lt.key).toContain(".row_1.");
      expect(project.i18nKeys[lt.key as never]).toBeDefined();

      useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: ds0.id,
        row: 0,
        path: ["id"],
        value: "vip",
      });
      useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: ds0.id,
        row: 0,
        path: ["icon"],
        value: "GOLD_INGOT",
      });
      project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
      row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect(row.id).toBe("vip");
      expect(row.icon).toBe("GOLD_INGOT");

      useProjectsStore
        .getState()
        .removeSourceRow({ projectId: PERSONAL, sourceId: ds0.id, index: 0 });
      project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect((project.dataSources[0] as { rows: unknown[] }).rows).toHaveLength(0);
      expect(project.i18nKeys[lt.key as never]).toBeUndefined();
    });

    it("assigns sequential Row keys before minting table ltexts", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });

      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

      const rows = (
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
          .dataSources[0] as { rows: Record<string, unknown>[] }
      ).rows;
      expect(rows.map((row) => row.id)).toEqual(["row_1", "row_2"]);
      // Addresses key on the source ID (ADR bare-data-files ④).
      expect((rows[1]!.lore as { key: string }).key).toBe(
        `sources.${source.id.toLowerCase()}.row_2.lore`,
      );
    });

    it("reuses the first available numeric Row key", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "retype", path: [], name: "id", newType: { kind: "integer" } },
      });
      useProjectsStore.setState((state) =>
        produce(state, (draft) => {
          const project = draft.openProjects.projects.find((p) => p.id === PERSONAL)!;
          const table = project.dataSources.find((dataSource) => dataSource.id === source.id)!;
          if (table.shape !== "table") throw new Error("expected table");
          table.rows.push({ id: 1 }, { id: 3 });
        }),
      );

      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

      const rows = (
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
          .dataSources[0] as { rows: Record<string, unknown>[] }
      ).rows;
      expect(rows.map((row) => row.id)).toEqual([1, 3, 2]);
    });

    it("rejects duplicate normalized Row keys without rekeying translations", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 0,
        path: ["id"],
        value: "vip",
      });
      useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 1,
        path: ["id"],
        value: "member",
      });
      const before = structuredClone(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!.i18nKeys,
      );

      const result = useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 1,
        path: ["id"],
        value: " VIP ",
      });

      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const rows = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows;
      expect(result).toEqual({ ok: false, reason: "duplicate_row_key" });
      expect(rows[1]!.id).toBe("member");
      expect(project.i18nKeys).toEqual(before);
    });

    it("rejects blank Row keys", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

      const result = useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 0,
        path: ["id"],
        value: "   ",
      });

      const row = (
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
          .dataSources[0] as { rows: Record<string, unknown>[] }
      ).rows[0]!;
      expect(result).toEqual({ ok: false, reason: "required_row_key" });
      expect(row.id).toBe("row_1");
    });

    it("normalizes valid Row-key renames and moves all translations", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      const prefix = `sources.${source.id.toLowerCase()}`;
      const oldKey = `${prefix}.row_1.lore`;
      useProjectsStore.setState((state) =>
        produce(state, (draft) => {
          const project = draft.openProjects.projects.find((p) => p.id === PERSONAL)!;
          project.i18nKeys[oldKey as never] = { en: "VIP lore", fr: "Description VIP" };
        }),
      );

      const result = useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 0,
        path: ["id"],
        value: " ELITE ",
      });

      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect(result).toEqual({ ok: true });
      expect(row.id).toBe("elite");
      expect((row.lore as { key: string }).key).toBe(`${prefix}.elite.lore`);
      expect(project.i18nKeys[`${prefix}.elite.lore` as never]).toEqual({
        en: "VIP lore",
        fr: "Description VIP",
      });
      expect(project.i18nKeys[oldKey as never]).toBeUndefined();
    });

    it("rekeys source translations when a table Row key changes", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

      let project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      let row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      const prefix = `sources.${source.id.toLowerCase()}`;
      const oldKey = (row.lore as { key: string }).key;
      expect(oldKey).toBe(`${prefix}.row_1.lore`);
      useProjectsStore.setState((state) =>
        produce(state, (draft) => {
          const current = draft.openProjects.projects.find((p) => p.id === PERSONAL)!;
          current.i18nKeys[oldKey as never] = { en: "VIP lore", fr: "Description VIP" };
        }),
      );

      useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 0,
        path: ["id"],
        value: "vip",
      });

      project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
      row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect((row.lore as { key: string }).key).toBe(`${prefix}.vip.lore`);
      expect(project.i18nKeys[`${prefix}.vip.lore` as never]).toEqual({
        en: "VIP lore",
        fr: "Description VIP",
      });
      expect(project.i18nKeys[oldKey as never]).toBeUndefined();
    });

    it("renaming a source does NOT re-address its keys (id-based addresses — ADR bare-data-files ④)", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      let project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      const oldKey = (row.lore as { key: string }).key;
      useProjectsStore.setState((state) =>
        produce(state, (draft) => {
          const current = draft.openProjects.projects.find((p) => p.id === PERSONAL)!;
          current.i18nKeys[oldKey as never] = { en: "Lore", fr: "Description" };
        }),
      );

      useProjectsStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });

      project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
      const renamedRow = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      // The address keys on the source ID — a display rename moves nothing.
      expect((renamedRow.lore as { key: string }).key).toBe(oldKey);
      expect(project.i18nKeys[oldKey as never]).toEqual({
        en: "Lore",
        fr: "Description",
      });
    });

    it("stores lowercase source names and rejects normalized duplicates", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const sources = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources;

      const firstResult = useProjectsStore.getState().renameProjectDataSource({
        projectId: PERSONAL,
        id: sources[0]!.id,
        newName: " Grades ",
      });
      const duplicateResult = useProjectsStore.getState().renameProjectDataSource({
        projectId: PERSONAL,
        id: sources[1]!.id,
        newName: "GRADES",
      });

      const renamed = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources;
      expect(firstResult).toBe(true);
      expect(renamed[0]!.name).toBe("grades");
      expect(duplicateResult).toBe(false);
      expect(renamed[1]!.name).toBe("new_source_2");
    });

    it("migrates existing opaque source keys when the projects are loaded", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useProjectsStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      useProjectsStore.setState((state) =>
        produce(state, (draft) => {
          const project = draft.openProjects.projects.find((p) => p.id === PERSONAL)!;
          const row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
          const semanticKey = (row.lore as { key: string }).key;
          delete project.i18nKeys[semanticKey as never];
          row.lore = { key: "lt_random" };
          project.i18nKeys["lt_random" as never] = { en: "Lore", fr: "Description" };
        }),
      );
      const loaded = structuredClone(useProjectsStore.getState().openProjects);

      useProjectsStore.getState().setOpenProjects(loaded);

      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const row = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      const canonical = `sources.${source.id.toLowerCase()}.row_1.lore`;
      expect((row.lore as { key: string }).key).toBe(canonical);
      expect(project.i18nKeys[canonical as never]).toEqual({
        en: "Lore",
        fr: "Description",
      });
      expect(project.i18nKeys["lt_random" as never]).toBeUndefined();
    });

    it("list items: add appends a minted element, remove releases it", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const ds0 = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: {
          op: "add",
          path: [],
          field: { name: "perks", type: { kind: "list", of: { kind: "ltext" } } },
        },
      });
      useProjectsStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: ds0.id });
      useProjectsStore
        .getState()
        .addSourceListItem({ projectId: PERSONAL, sourceId: ds0.id, row: 0, path: ["perks"] });
      let project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const perks = (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!
        .perks as {
        key: string;
      }[];
      expect(perks).toHaveLength(1);
      expect(perks[0]!.key).not.toBe("");
      const key = perks[0]!.key;
      expect(project.i18nKeys[key as never]).toBeDefined();
      useProjectsStore.getState().removeSourceListItem({
        projectId: PERSONAL,
        sourceId: ds0.id,
        row: 0,
        path: ["perks"],
        index: 0,
      });
      project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect(
        (project.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!.perks,
      ).toEqual([]);
      expect(project.i18nKeys[key as never]).toBeUndefined();
    });

    it("config: cell set operates on the value object (row: null)", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL, shape: "config" });
      const ds0 = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "config", sourceId: ds0.id },
        edit: { op: "add", path: [], field: { name: "currency", type: { kind: "string" } } },
      });
      useProjectsStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: ds0.id,
        row: null,
        path: ["currency"],
        value: "coins",
      });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect((project.dataSources[0] as { value: Record<string, unknown> }).value.currency).toBe(
        "coins",
      );
    });

    it("editSourceField refuses a model ref that would create a cycle", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const ds0 = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: {
          op: "add",
          path: [],
          field: { name: "self", type: { kind: "model", ref: ds0.modelId } },
        },
      });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect(project.dataModels![0]!.fields.some((f) => f.name === "self")).toBe(false);
    });

    it("renameDataModel + setModelKeyField update the model", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const ds0 = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      useProjectsStore
        .getState()
        .renameDataModel({ projectId: PERSONAL, modelId: ds0.modelId, newName: "rank" });
      useProjectsStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "slug", type: { kind: "string" } } },
      });
      useProjectsStore
        .getState()
        .setModelKeyField({ projectId: PERSONAL, modelId: ds0.modelId, keyField: "slug" });
      const m = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
        .dataModels![0]!;
      expect(m.name).toBe("rank");
      expect(m.keyField).toBe("slug");
    });

    it("renames a data source", () => {
      useProjectsStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const id = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!.id;
      useProjectsStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id, newName: "categories" });
      expect(
        useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
          .dataSources[0]!.name,
      ).toBe("categories");
    });
  });

  it("createProject clears the temporal stack", () => {
    useProjectsStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "EMERALD",
    });
    useProjectsStore.getState().createProject({ id: "fresh_pack" });
    // pastStates should be empty after createProject clears the stack
    expect(useProjectsStore.temporal.getState().pastStates.length).toBe(0);
  });

  describe("semantic i18n keys", () => {
    it("createMenu initializes title with a default vanilla (plain) layer", () => {
      const mId = useProjectsStore.getState().createMenu({
        projectId: PERSONAL,
        id: "my_menu",
      });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const menu = menusOf(project).find((m) => m.id === mId)!;
      expect(Array.isArray(menu.title)).toBe(true);
      expect(menu.title).toHaveLength(1);
      expect(menu.title[0]!.kind).toBe("plain");
      if (menu.title[0]!.kind === "plain") {
        // Empty key is the sentinel — rekeyed at deploy time or when setMenuTitle
        // is called.
        expect(menu.title[0]!.value.key).toBe("");
      }
    });

    it("setMenuTitle writes into the default plain layer (no extra layer prepended)", () => {
      const mId = useProjectsStore
        .getState()
        .createMenu({ projectId: PERSONAL, id: "lazy_test_menu" });
      useProjectsStore
        .getState()
        .setMenuTitle({ projectId: PERSONAL, menuId: mId, lang: "en", value: "Lazy" });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const menu = menusOf(project).find((m) => m.id === mId)!;
      expect(menu.title).toHaveLength(1);
      const first = menu.title[0]!;
      expect(first.kind).toBe("plain");
      if (first.kind === "plain") {
        expect(first.value.key).toBe(`menus.${mId}.title`);
        expect(project.i18nKeys[first.value.key]?.en).toBe("Lazy");
      }
    });

    it("setMenuId renames i18n keys to new prefix", () => {
      const pack0 = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const menu0 = menusOf(pack0).find((m) => m.id === SHOP_MAIN)!;
      // title is now MenuTitleLayer[]; grab the first text layer's key.
      const firstLayer0 = menu0.title[0];
      expect(firstLayer0?.kind).toBe("text");
      const oldTitleKey = firstLayer0?.kind === "text" ? firstLayer0.value.key : undefined;
      expect(oldTitleKey).toBeDefined();

      useProjectsStore
        .getState()
        .setMenuId({ projectId: PERSONAL, oldId: SHOP_MAIN, newId: menuId("m_shop_new") });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const menu = menusOf(project).find((m) => m.id === menuId("m_shop_new"))!;

      const firstLayer = menu.title[0];
      expect(firstLayer?.kind).toBe("text");
      const newTitleKey = firstLayer?.kind === "text" ? firstLayer.value.key : undefined;
      expect(newTitleKey).toBe("menus.m_shop_new.title");
      expect(project.i18nKeys["menus.m_shop_new.title" as I18nKey]).toBeDefined();
      expect(project.i18nKeys[oldTitleKey!]).toBeUndefined();
    });

    it("setElementId renames element i18n keys to new semantic key", () => {
      // The mock fixture already has an opaque title on PROFILE_BTN. Capture it
      // before rename, then verify rekeyMenu moved it to the semantic slot.
      const pack0 = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const el0 = menusOf(pack0)
        .find((m) => m.id === SHOP_MAIN)!
        .layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const oldKey = el0.display!.title?.key;
      expect(oldKey).toBeDefined(); // fixture has a title

      useProjectsStore.getState().setElementId({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        oldId: PROFILE_BTN,
        newId: elementId("el_btn_new"),
      });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const menu = menusOf(project).find((m) => m.id === SHOP_MAIN)!;
      const el = menu.layers[0]!.elements.find((e) => e.id === elementId("el_btn_new"))!;

      const expectedKey = `menus.${SHOP_MAIN}.elements.el_btn_new.default.title` as I18nKey;
      expect(el.display!.title?.key).toBe(expectedKey);
      expect(project.i18nKeys[expectedKey]).toBeDefined();
      expect(project.i18nKeys[oldKey!]).toBeUndefined();
    });

    it("addElementStep allocates semantic key for send_message", () => {
      useProjectsStore.getState().addElementStep({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementId: PROFILE_BTN,
        appearanceIndex: 0,
        clickType: "left",
        frames: [],
        index: -1,
        step: { kind: "action", action: { name: "send_message", value: { key: "" as I18nKey } } },
        lang: "en",
      });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const el = menusOf(project)
        .find((m) => m.id === SHOP_MAIN)!
        .layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const steps = el.display!.click!.left!.steps;
      const last = steps[steps.length - 1]!;
      if (last.kind !== "action" || last.action.name !== "send_message") throw new Error();
      const expectedPrefix = `menus.${SHOP_MAIN}.elements.${PROFILE_BTN}.default.click.left`;
      expect((last.action.value as { key: string }).key).toBe(`${expectedPrefix}.message`);
    });

    it("addElementStep allocates semantic keys for show_title (title + subtitle)", () => {
      useProjectsStore.getState().addElementStep({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementId: PROFILE_BTN,
        appearanceIndex: 0,
        clickType: "left",
        frames: [],
        index: -1,
        step: {
          kind: "action",
          action: {
            name: "show_title",
            value: { title: { key: "" as I18nKey }, subtitle: { key: "" as I18nKey } },
          },
        },
        lang: "en",
      });
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const el = menusOf(project)
        .find((m) => m.id === SHOP_MAIN)!
        .layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const steps = el.display!.click!.left!.steps;
      const last = steps[steps.length - 1]!;
      if (last.kind !== "action" || last.action.name !== "show_title") throw new Error();
      const expectedPrefix = `menus.${SHOP_MAIN}.elements.${PROFILE_BTN}.default.click.left`;
      const value = last.action.value as { title: { key: string }; subtitle: { key: string } };
      expect(value.title.key).toBe(`${expectedPrefix}.show_title`);
      expect(value.subtitle.key).toBe(`${expectedPrefix}.show_subtitle`);
    });

    it("addElementStep allocates distinct keys for multiple send_message steps", () => {
      const addMsg = () =>
        useProjectsStore.getState().addElementStep({
          projectId: PERSONAL,
          menuId: SHOP_MAIN,
          elementId: PROFILE_BTN,
          appearanceIndex: 0,
          clickType: "left",
          frames: [],
          index: -1,
          step: { kind: "action", action: { name: "send_message", value: { key: "" as I18nKey } } },
          lang: "en",
        });

      addMsg();
      addMsg();

      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      const el = menusOf(project)
        .find((m) => m.id === SHOP_MAIN)!
        .layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const steps = el.display!.click!.left!.steps;
      const msgSteps = steps.filter(
        (s): s is Extract<typeof s, { kind: "action" }> =>
          s.kind === "action" && s.action.name === "send_message",
      );
      const keys = msgSteps.map((s) => (s.action.value as { key: string }).key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("rename intents in the draft", () => {
    const renames = () => useProjectDraftStore.getState().pendingRenames[PERSONAL] ?? [];
    beforeEach(() => useProjectDraftStore.setState({ pendingRenames: {} }));

    it("an applied rename is recorded as a move", () => {
      useProjectsStore
        .getState()
        .setMenuId({ projectId: PERSONAL, oldId: SHOP_MAIN, newId: menuId("m_shop_renamed") });
      expect(renames()).toEqual([
        { from: "menus/m_shop_main.yml", to: "menus/m_shop_renamed.yml" },
      ]);
    });

    it("a refused rename leaves no intent behind", () => {
      const s = useProjectsStore.getState();
      expect(() =>
        s.setMenuId({ projectId: PERSONAL, oldId: SHOP_MAIN, newId: menuId("m_about") }),
      ).toThrow(/already exists/);
      expect(() =>
        s.setMenuId({ projectId: PERSONAL, oldId: SHOP_MAIN, newId: "" as never }),
      ).toThrow(/empty/);
      expect(() =>
        s.setCommandId({ projectId: PERSONAL, oldId: commandId("c_heal"), newId: "" as never }),
      ).toThrow(/empty/);
      const dId = s.createDialog({ projectId: PERSONAL, id: "d_one" });
      s.createDialog({ projectId: PERSONAL, id: "d_two" });
      expect(() =>
        useProjectsStore
          .getState()
          .setDialogId({ projectId: PERSONAL, oldId: dId, newId: dialogId("d_two") }),
      ).toThrow(/already exists/);
      // Unknown source: nothing to move either.
      s.setMenuId({ projectId: PERSONAL, oldId: menuId("m_missing"), newId: menuId("m_new") });
      s.setCommandId({
        projectId: PERSONAL,
        oldId: commandId("c_missing"),
        newId: commandId("c_new"),
      });
      expect(renames()).toEqual([]);
    });
  });

  describe("title layer actions", () => {
    const setupMenu = () => {
      const mId = useProjectsStore
        .getState()
        .createMenu({ projectId: PERSONAL, id: "tl_test_menu" });
      // createMenu seeds a default Plain (vanilla) layer; reset to empty so each
      // test starts from a clean slate.
      useProjectsStore
        .getState()
        .setMenuTitleLayers({ projectId: PERSONAL, menuId: mId, layers: [] });
      return mId;
    };

    const getMenu = (mId: string) => {
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      return menusOf(project).find((m) => m.id === mId)!;
    };

    it("addMenuTitleLayer appends a layer", () => {
      const mId = setupMenu();
      const layer: MenuTitleLayer = {
        kind: "glyph",
        assetId: "asset_foo" as import("@/domain/types").AssetId,
        x: 0,
        y: 0,
      };
      useProjectsStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer });
      const menu = getMenu(mId);
      expect(menu.title).toHaveLength(1);
      expect(menu.title[0]!.kind).toBe("glyph");
    });

    it("removeMenuTitleLayer removes by index", () => {
      const mId = setupMenu();
      const layerA: MenuTitleLayer = {
        kind: "glyph",
        assetId: "asset_a" as import("@/domain/types").AssetId,
        x: 0,
        y: 0,
      };
      const layerB: MenuTitleLayer = {
        kind: "glyph",
        assetId: "asset_b" as import("@/domain/types").AssetId,
        x: 10,
        y: 0,
      };
      useProjectsStore
        .getState()
        .addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: layerA });
      useProjectsStore
        .getState()
        .addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: layerB });
      useProjectsStore
        .getState()
        .removeMenuTitleLayer({ projectId: PERSONAL, menuId: mId, index: 0 });
      const menu = getMenu(mId);
      expect(menu.title).toHaveLength(1);
      expect(menu.title[0]!.kind).toBe("glyph");
      if (menu.title[0]!.kind === "glyph") {
        expect(menu.title[0]!.assetId).toBe("asset_b");
      }
    });

    it("reorderMenuTitleLayers moves a layer", () => {
      const mId = setupMenu();
      const mkGlyph = (id: string): MenuTitleLayer => ({
        kind: "glyph",
        assetId: id as import("@/domain/types").AssetId,
        x: 0,
        y: 0,
      });
      useProjectsStore
        .getState()
        .addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: mkGlyph("first") });
      useProjectsStore
        .getState()
        .addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: mkGlyph("second") });
      useProjectsStore
        .getState()
        .addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: mkGlyph("third") });
      // Move index 0 ("first") to index 2 (last).
      useProjectsStore
        .getState()
        .reorderMenuTitleLayers({ projectId: PERSONAL, menuId: mId, fromIndex: 0, toIndex: 2 });
      const menu = getMenu(mId);
      const ids = menu.title.map((l) => (l.kind === "glyph" ? l.assetId : "?"));
      expect(ids).toEqual(["second", "third", "first"]);
    });

    it("updateMenuTitleLayer patches a layer", () => {
      const mId = setupMenu();
      const layer: MenuTitleLayer = {
        kind: "glyph",
        assetId: "asset_orig" as import("@/domain/types").AssetId,
        x: 0,
        y: 0,
      };
      useProjectsStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer });
      useProjectsStore.getState().updateMenuTitleLayer({
        projectId: PERSONAL,
        menuId: mId,
        index: 0,
        patch: { x: 42 },
      });
      const menu = getMenu(mId);
      const first = menu.title[0]!;
      expect(first.kind).toBe("glyph");
      if (first.kind === "glyph") expect(first.x).toBe(42);
    });

    it("setMenuTitleLayers replaces entire array", () => {
      const mId = setupMenu();
      useProjectsStore.getState().addMenuTitleLayer({
        projectId: PERSONAL,
        menuId: mId,
        layer: { kind: "background", assetId: "bg1" as import("@/domain/types").AssetId },
      });
      const newLayers: MenuTitleLayer[] = [
        { kind: "background", assetId: "bg2" as import("@/domain/types").AssetId },
        { kind: "background", assetId: "bg3" as import("@/domain/types").AssetId },
      ];
      useProjectsStore
        .getState()
        .setMenuTitleLayers({ projectId: PERSONAL, menuId: mId, layers: newLayers });
      const menu = getMenu(mId);
      expect(menu.title).toHaveLength(2);
      if (menu.title[0]!.kind === "background") expect(menu.title[0]!.assetId).toBe("bg2");
      if (menu.title[1]!.kind === "background") expect(menu.title[1]!.assetId).toBe("bg3");
    });

    it("setMenuTitleLayers releases dropped text-layer i18n keys but keeps migrated ones", () => {
      const mId = setupMenu();
      const droppedKey = "lt_dropped" as I18nKey;
      const keptKey = "lt_kept" as I18nKey;
      // A text layer (dropped) and a plain layer (migrated to the new set).
      useProjectsStore.getState().setMenuTitleLayers({
        projectId: PERSONAL,
        menuId: mId,
        layers: [
          { kind: "text", value: { key: droppedKey }, x: 8, y: 5 },
          { kind: "plain", value: { key: keptKey } },
        ],
      });
      // Seed translations for both so we can watch the GC.
      useProjectsStore.getState().setI18nValue({
        projectId: PERSONAL,
        lt: { key: droppedKey },
        lang: "en",
        value: "Boutique",
      });
      useProjectsStore
        .getState()
        .setI18nValue({ projectId: PERSONAL, lt: { key: keptKey }, lang: "en", value: "Shop" });

      // Collapse to vanilla, migrating only keptKey.
      useProjectsStore.getState().setMenuTitleLayers({
        projectId: PERSONAL,
        menuId: mId,
        layers: [{ kind: "plain", value: { key: keptKey } }],
      });

      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      // droppedKey is now orphaned → released; keptKey survives.
      expect(project.i18nKeys[droppedKey]).toBeUndefined();
      expect(project.i18nKeys[keptKey]!.en).toBe("Shop");
    });

    it("removeMenuTitleLayer GCs the removed text layer's i18n key", () => {
      const mId = setupMenu();
      const key = "lt_removed_title" as I18nKey;
      useProjectsStore.getState().setMenuTitleLayers({
        projectId: PERSONAL,
        menuId: mId,
        layers: [{ kind: "text", value: { key }, x: 8, y: 5 }],
      });
      useProjectsStore
        .getState()
        .setI18nValue({ projectId: PERSONAL, lt: { key }, lang: "en", value: "Gone" });
      useProjectsStore
        .getState()
        .removeMenuTitleLayer({ projectId: PERSONAL, menuId: mId, index: 0 });

      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === PERSONAL)!;
      expect(project.i18nKeys[key]).toBeUndefined();
    });
  });
});

describe("projectsStore — board positions", () => {
  const P = projectId("p_personal");
  const project = () => useProjectsStore.getState().openProjects.projects.find((p) => p.id === P)!;

  beforeEach(() => {
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
    useProjectsStore.temporal.getState().clear();
  });

  it("releaseBoardPositions releases every hand-placed position, without touching the Documents", () => {
    useProjectsStore
      .getState()
      .setCanvasPosition({ projectId: P, nodeId: "menu/m_about", x: 5, y: 6 });
    const menus = menusOf(project()).map((m) => m.id);
    useProjectsStore.getState().releaseBoardPositions({ projectId: P });
    expect(project().canvasLayout).toEqual({});
    expect(menusOf(project()).map((m) => m.id)).toEqual(menus);
  });

  it("releaseBoardPositions also releases the forced link anchors", () => {
    useProjectsStore.getState().setEdgeAnchor({
      projectId: P,
      edgeId: "m_shop_main->m_profile",
      end: "from",
      anchor: { side: "bottom", t: 0.5 },
    });
    expect(Object.keys(project().canvasEdges ?? {})).toHaveLength(1);
    useProjectsStore.getState().releaseBoardPositions({ projectId: P });
    expect(project().canvasEdges ?? {}).toEqual({});
  });

  it("releaseBoardPositions can be undone: the positions come back", () => {
    useProjectsStore
      .getState()
      .setCanvasPosition({ projectId: P, nodeId: "menu/m_about", x: 5, y: 6 });
    useProjectsStore.getState().releaseBoardPositions({ projectId: P });
    useProjectsStore.temporal.getState().undo();
    expect((project().canvasLayout as Record<string, unknown>)["menu/m_about"]).toEqual({
      x: 5,
      y: 6,
    });
  });
});
