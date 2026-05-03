import { elementId, menuId, packId } from "@/domain/ids";
import type { I18nKey } from "@/domain/types";
import { mockAccount } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

const PERSONAL = packId("p_personal");
const SHOP_MAIN = menuId("m_shop_main");
const PROFILE_BTN = elementId("el_btn_profile");

const findElement = (mId = SHOP_MAIN, eId = PROFILE_BTN) => {
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  const menu = pack.menus.find((m) => m.id === mId)!;
  return menu.layers[0]!.elements.find((el) => el.id === eId);
};

describe("accountStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
  });

  it("starts with the seed account", () => {
    expect(useAccountStore.getState().account.packs).toHaveLength(3);
  });

  it("createPack appends to packs and packOrder", () => {
    useAccountStore.getState().createPack({ name: "New Pack" });
    const a = useAccountStore.getState().account;
    expect(a.packs).toHaveLength(4);
    expect(a.packOrder).toHaveLength(4);
    expect(a.packs[3]!.name).toBe("New Pack");
  });

  it("reorderPacks rewrites packOrder", () => {
    const original = useAccountStore.getState().account.packOrder;
    const reversed = [...original].reverse();
    useAccountStore.getState().reorderPacks(reversed);
    expect(useAccountStore.getState().account.packOrder).toEqual(reversed);
  });

  it("moveMenuToPack moves the menu across packs", () => {
    const fromId = packId("p_personal");
    const toId = packId("p_shop_system");
    const menuToMove = menuId("m_about");

    useAccountStore
      .getState()
      .moveMenuToPack({ menuId: menuToMove, fromPackId: fromId, toPackId: toId });

    const a = useAccountStore.getState().account;
    const from = a.packs.find((p) => p.id === fromId)!;
    const to = a.packs.find((p) => p.id === toId)!;
    expect(from.menus.some((m) => m.id === menuToMove)).toBe(false);
    expect(to.menus.some((m) => m.id === menuToMove)).toBe(true);
    expect(to.menus.find((m) => m.id === menuToMove)!.packId).toBe(toId);
  });

  it("moveMenuToPack succeeds even when refs become dangling", () => {
    // m_shop_main has open_menu actions targeting menus in p_personal.
    // We no longer enforce hermeticity — the runtime is responsible for
    // tolerating missing targets — so the move just goes through.
    const fromId = packId("p_personal");
    const toId = packId("p_shop_system");
    const sourceMenu = menuId("m_shop_main");

    useAccountStore
      .getState()
      .moveMenuToPack({ menuId: sourceMenu, fromPackId: fromId, toPackId: toId });

    const a = useAccountStore.getState().account;
    expect(a.packs.find((p) => p.id === fromId)!.menus.some((m) => m.id === sourceMenu)).toBe(
      false,
    );
    expect(a.packs.find((p) => p.id === toId)!.menus.some((m) => m.id === sourceMenu)).toBe(true);
  });

  it("deleteFromPack removes a leaf menu and its canvas position", () => {
    const pId = packId("p_personal");
    useAccountStore.getState().deleteFromPack({ packId: pId, nodeIds: ["m_about"] });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === pId)!;
    expect(pack.menus.some((m) => m.id === "m_about")).toBe(false);
    expect("m_about" in pack.canvasLayout).toBe(false);
  });

  it("deleteFromPack succeeds even when the menu has inbound refs", () => {
    // m_profile is referenced by m_shop_main's actions. Deleting it leaves
    // those refs dangling — that's fine; the runtime no-ops on missing
    // open_menu targets.
    const pId = packId("p_personal");
    useAccountStore.getState().deleteFromPack({ packId: pId, nodeIds: ["m_profile"] });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === pId)!;
    expect(pack.menus.some((m) => m.id === "m_profile")).toBe(false);
  });

  it("setSlotMaterial updates an existing element at that position", () => {
    useAccountStore.getState().setSlotMaterial({
      packId: packId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "DIAMOND",
    });
    const pack = useAccountStore
      .getState()
      .account.packs.find((p) => p.id === packId("p_personal"))!;
    const menu = pack.menus.find((m) => m.id === "m_shop_main")!;
    const el = menu.layers[0]!.elements.find((e) => e.positions === "13")!;
    expect(el.appearances[0]!.material).toBe("DIAMOND");
  });

  it("setSlotMaterial creates an element at an empty position", () => {
    useAccountStore.getState().setSlotMaterial({
      packId: packId("p_personal"),
      menuId: menuId("m_about"),
      position: 5,
      material: "PAPER",
    });
    const pack = useAccountStore
      .getState()
      .account.packs.find((p) => p.id === packId("p_personal"))!;
    const menu = pack.menus.find((m) => m.id === "m_about")!;
    const el = menu.layers[0]!.elements.find((e) => e.positions === "5");
    expect(el?.appearances[0]?.material).toBe("PAPER");
  });

  it("temporal.undo reverts a slot material change", () => {
    useAccountStore.temporal.getState().clear();
    useAccountStore.getState().setSlotMaterial({
      packId: packId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "EMERALD",
    });
    expect(
      useAccountStore
        .getState()
        .account.packs.find((p) => p.id === "p_personal")!
        .menus.find((m) => m.id === "m_shop_main")!
        .layers[0]!.elements.find((e) => e.positions === "13")?.appearances[0]?.material,
    ).toBe("EMERALD");

    useAccountStore.temporal.getState().undo();

    expect(
      useAccountStore
        .getState()
        .account.packs.find((p) => p.id === "p_personal")!
        .menus.find((m) => m.id === "m_shop_main")!
        .layers[0]!.elements.find((e) => e.positions === "13")?.appearances[0]?.material,
    ).not.toBe("EMERALD");
  });

  it("setElementPositions replaces the element's positions string", () => {
    useAccountStore.getState().setElementPositions({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-2,13",
    });
    expect(findElement()?.positions).toBe("0-2,13");
  });

  it("addElementPosition (Alt+drag duplicate) extends the positions list", () => {
    useAccountStore.getState().addElementPosition({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      position: 14,
    });
    expect(findElement()?.positions).toBe("13-14");
  });

  it("addElementPosition steals the slot from another element", () => {
    // Seed a second element at position 22, then duplicate the profile button onto it.
    useAccountStore.getState().setSlotMaterial({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      position: 22,
      material: "DIRT",
    });
    useAccountStore.getState().addElementPosition({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      position: 22,
    });
    expect(findElement()?.positions).toBe("13,22");
    // The DIRT element lost its only position and was pruned entirely.
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const dirt = menu.layers[0]!.elements.find((el) => el.appearances[0]?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("moveElementPosition relocates a single position", () => {
    useAccountStore.getState().setElementPositions({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "13",
    });
    useAccountStore.getState().moveElementPosition({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      fromPosition: 13,
      toPosition: 4,
    });
    expect(findElement()?.positions).toBe("4");
  });

  it("moveElementPosition keeps multi-pos elements in sync", () => {
    useAccountStore.getState().setElementPositions({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-2",
    });
    useAccountStore.getState().moveElementPosition({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      fromPosition: 1,
      toPosition: 5,
    });
    expect(findElement()?.positions).toBe("0,2,5");
  });

  it("clearSlot on a multi-pos element removes only that position", () => {
    useAccountStore.getState().setElementPositions({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-3",
    });
    useAccountStore.getState().clearSlot({ packId: PERSONAL, menuId: SHOP_MAIN, position: 1 });
    expect(findElement()?.positions).toBe("0,2-3");
  });

  it("clearSlot deletes the element when its last position goes", () => {
    useAccountStore.getState().clearSlot({ packId: PERSONAL, menuId: SHOP_MAIN, position: 13 });
    expect(findElement()).toBeUndefined();
  });

  it("deleteElement removes the entire element regardless of position count", () => {
    useAccountStore.getState().setElementPositions({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-8",
    });
    useAccountStore.getState().deleteElement({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
    });
    expect(findElement()).toBeUndefined();
  });

  it("addElement inserts a new element and strips conflicting positions from siblings", () => {
    // Seed a sibling element at position 5
    useAccountStore
      .getState()
      .setSlotMaterial({ packId: PERSONAL, menuId: SHOP_MAIN, position: 5, material: "DIRT" });
    useAccountStore.getState().addElement({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      element: {
        id: elementId("el_pasted"),
        positions: "5,6",
        appearances: [{ material: "GOLD_INGOT" }],
      },
    });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const pasted = menu.layers[0]!.elements.find((el) => el.id === "el_pasted");
    expect(pasted?.positions).toBe("5-6");
    // The DIRT element lost its only position and was pruned.
    const dirt = menu.layers[0]!.elements.find((el) => el.appearances[0]?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("moveSelectionByDelta shifts every selected element by (dCol, dRow)", () => {
    // m_shop_main has rows=3 → row indices 0..2.
    useAccountStore.getState().setElementPositions({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0,1",
    });
    useAccountStore
      .getState()
      .setSlotMaterial({ packId: PERSONAL, menuId: SHOP_MAIN, position: 9, material: "STONE" });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const stoneId = menu.layers[0]!.elements.find(
      (el) => el.appearances[0]?.material === "STONE",
    )!.id;

    useAccountStore.getState().moveSelectionByDelta({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN, stoneId],
      dCol: 1,
      dRow: 1,
    });

    expect(findElement()?.positions).toBe("10-11");
    const stoneAfter = useAccountStore
      .getState()
      .account.packs.find((p) => p.id === PERSONAL)!
      .menus.find((m) => m.id === SHOP_MAIN)!
      .layers[0]!.elements.find((el) => el.id === stoneId);
    expect(stoneAfter?.positions).toBe("19");
  });

  it("moveSelectionByDelta strips claimed positions from non-target elements", () => {
    // PROFILE_BTN at 13. Add another element at 14, then drag PROFILE_BTN by +1
    useAccountStore
      .getState()
      .setSlotMaterial({ packId: PERSONAL, menuId: SHOP_MAIN, position: 14, material: "DIRT" });
    useAccountStore.getState().moveSelectionByDelta({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN],
      dCol: 1,
      dRow: 0,
    });
    expect(findElement()?.positions).toBe("14");
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const dirt = menu.layers[0]!.elements.find((el) => el.appearances[0]?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("moveSelectionByDelta throws when the move goes out of bounds", () => {
    expect(() =>
      useAccountStore.getState().moveSelectionByDelta({
        packId: PERSONAL,
        menuId: SHOP_MAIN,
        elementIds: [PROFILE_BTN],
        dCol: 0,
        dRow: 99,
      }),
    ).toThrow(/outside the menu/);
    // Source unchanged.
    expect(findElement()?.positions).toBe("13");
  });

  it("addAppearance pushes a conditional state seeded with a placeholder permission", () => {
    useAccountStore
      .getState()
      .addAppearance({ packId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN });
    const el = findElement()!;
    expect(el.appearances).toHaveLength(2);
    const seeded = el.appearances[1]!;
    expect(seeded.if?.[0]?.type).toBe("has_permission");
  });

  it("removeAppearance keeps at least one appearance and is otherwise idempotent on out-of-range", () => {
    // Add a state, then remove it.
    useAccountStore
      .getState()
      .addAppearance({ packId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN });
    useAccountStore.getState().removeAppearance({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 1,
    });
    expect(findElement()!.appearances).toHaveLength(1);
    // Removing the lone remaining appearance is a no-op (we keep one).
    useAccountStore.getState().removeAppearance({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
    });
    expect(findElement()!.appearances).toHaveLength(1);
  });

  it("addElementClickHandler creates an empty handler at clickType, removeElementClickHandler clears it", () => {
    useAccountStore.getState().addElementClickHandler({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "right",
    });
    expect(findElement()!.appearances[0]?.click?.right?.steps).toEqual([]);
    useAccountStore.getState().removeElementClickHandler({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "right",
    });
    expect(findElement()!.appearances[0]?.click?.right).toBeUndefined();
  });

  it("addElementStep appends and removeElementStep drops by path", () => {
    useAccountStore.getState().addElementStep({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      index: -1,
      step: { kind: "action", action: { type: "close_menu" } },
      lang: "en",
    });
    let steps = findElement()!.appearances[0]!.click!.left!.steps;
    expect(steps).toHaveLength(2);
    expect(steps[1]?.kind).toBe("action");
    useAccountStore.getState().removeElementStep({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      path: { frames: [], index: 1 },
    });
    steps = findElement()!.appearances[0]!.click!.left!.steps;
    expect(steps).toHaveLength(1);
  });

  it("moveElementStep reorders steps within a chain", () => {
    useAccountStore.getState().addElementStep({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      index: -1,
      step: {
        kind: "action",
        action: { type: "send_message", text: { key: "" as I18nKey } },
      },
      lang: "en",
    });
    useAccountStore.getState().moveElementStep({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      fromIndex: 1,
      toIndex: 0,
    });
    const steps = findElement()!.appearances[0]!.click!.left!.steps;
    expect(steps[0]?.kind === "action" && steps[0].action.type).toBe("send_message");
    expect(steps[1]?.kind === "action" && steps[1].action.type).toBe("open_menu");
  });

  it("addElementStep into an if-step's case descends through the path", () => {
    // Replace the existing chain with an if-step.
    useAccountStore.getState().setElementStep({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      path: { frames: [], index: 0 },
      step: { kind: "if", cases: [{ conditions: [], steps: [] }] },
      lang: "en",
    });
    useAccountStore.getState().addElementStep({
      packId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [{ stepIndex: 0, descend: { case: 0 } }],
      index: 0,
      step: { kind: "action", action: { type: "close_menu" } },
      lang: "en",
    });
    const root = findElement()!.appearances[0]!.click!.left!.steps[0]!;
    if (root.kind !== "if") throw new Error("expected if");
    expect(root.cases[0]!.steps).toHaveLength(1);
    expect(root.cases[0]!.steps[0]?.kind).toBe("action");
  });

  describe("command arg order validation", () => {
    const pId = packId("p_personal");

    it("addCommandArg throws when appending required after optional", () => {
      const cId = useAccountStore.getState().createCommand({ packId: pId });
      useAccountStore.getState().addCommandArg({
        packId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      expect(() =>
        useAccountStore.getState().addCommandArg({
          packId: pId,
          commandId: cId,
          arg: { name: "req", type: "string", required: true },
        }),
      ).toThrow(/cannot follow/);
    });

    it("setCommandArg throws when making an arg required after an optional one", () => {
      const cId = useAccountStore.getState().createCommand({ packId: pId });
      useAccountStore.getState().addCommandArg({
        packId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      useAccountStore.getState().addCommandArg({
        packId: pId,
        commandId: cId,
        arg: { name: "second", type: "string", required: false },
      });
      expect(() =>
        useAccountStore.getState().setCommandArg({
          packId: pId,
          commandId: cId,
          index: 1,
          arg: { name: "second", type: "string", required: true },
        }),
      ).toThrow(/cannot follow/);
    });

    it("valid order (required then optional) succeeds", () => {
      const cId = useAccountStore.getState().createCommand({ packId: pId });
      useAccountStore.getState().addCommandArg({
        packId: pId,
        commandId: cId,
        arg: { name: "target", type: "player", required: true },
      });
      useAccountStore.getState().addCommandArg({
        packId: pId,
        commandId: cId,
        arg: { name: "amount", type: "integer", required: false },
      });
      const cmd = useAccountStore
        .getState()
        .account.packs.find((p) => p.id === pId)!
        .commands.find((c) => c.id === cId)!;
      expect(cmd.arguments).toHaveLength(2);
      expect(cmd.arguments[0]!.required).toBe(true);
      expect(cmd.arguments[1]!.required).toBe(false);
    });

    it("state is unchanged when validation throws", () => {
      const cId = useAccountStore.getState().createCommand({ packId: pId });
      useAccountStore.getState().addCommandArg({
        packId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      try {
        useAccountStore.getState().addCommandArg({
          packId: pId,
          commandId: cId,
          arg: { name: "req", type: "string", required: true },
        });
      } catch {
        // expected
      }
      const cmd = useAccountStore
        .getState()
        .account.packs.find((p) => p.id === pId)!
        .commands.find((c) => c.id === cId)!;
      expect(cmd.arguments).toHaveLength(1);
    });
  });

  describe("menu contextInput discriminated union", () => {
    it("addMenuContextInput with kind='primitive' adds a primitive input", () => {
      const pId = packId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        packId: pId,
        menuId: mId,
        kind: "primitive",
      });
      const menu = useAccountStore
        .getState()
        .account.packs.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const added = (menu.contextInputs ?? []).at(-1);
      expect(added?.kind).toBe("primitive");
      if (added?.kind === "primitive") {
        expect(added.type).toBe("string");
      }
    });

    it("addMenuContextInput with kind='sourceRef' adds a sourceRef input", () => {
      const pId = packId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        packId: pId,
        menuId: mId,
        kind: "sourceRef",
      });
      const menu = useAccountStore
        .getState()
        .account.packs.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const added = (menu.contextInputs ?? []).at(-1);
      expect(added?.kind).toBe("sourceRef");
    });

    it("setMenuContextInput persists a sourceRef input", () => {
      const pId = packId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        packId: pId,
        menuId: mId,
        kind: "sourceRef",
      });
      const before = useAccountStore
        .getState()
        .account.packs.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const idx = (before.contextInputs ?? []).findIndex((c) => c.kind === "sourceRef");
      expect(idx).toBeGreaterThanOrEqual(0);

      useAccountStore.getState().setMenuContextInput({
        packId: pId,
        menuId: mId,
        index: idx,
        input: {
          kind: "sourceRef",
          name: "shops",
          ref: "chestshop:items" as import("@/domain/types").SourceRef,
        },
      });

      const after = useAccountStore
        .getState()
        .account.packs.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const stored = (after.contextInputs ?? []).find((c) => c.name === "shops");
      expect(stored?.kind).toBe("sourceRef");
      if (stored?.kind === "sourceRef") {
        expect(stored.ref).toBe("chestshop:items");
      }
    });

    it("setMenuContextInput can update a primitive input to a different type", () => {
      const pId = packId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        packId: pId,
        menuId: mId,
        kind: "primitive",
      });
      const before = useAccountStore
        .getState()
        .account.packs.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const idx = (before.contextInputs ?? []).findIndex((c) => c.kind === "primitive");

      useAccountStore.getState().setMenuContextInput({
        packId: pId,
        menuId: mId,
        index: idx,
        input: { kind: "primitive", name: "category", type: "player" },
      });

      const stored = (
        useAccountStore
          .getState()
          .account.packs.find((p) => p.id === pId)!
          .menus.find((m) => m.id === mId)!.contextInputs ?? []
      ).find((c) => c.name === "category");
      expect(stored?.kind).toBe("primitive");
      if (stored?.kind === "primitive") {
        expect(stored.type).toBe("player");
      }
    });
  });

  describe("DataSource reducers", () => {
    it("adds a list data source with default name and shape", () => {
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "list" });
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
      expect(pack.dataSources).toHaveLength(1);
      expect(pack.dataSources[0]!.name).toBe("new_list");
      expect(pack.dataSources[0]!.type).toEqual({ kind: "list", of: { kind: "string" } });
      expect(pack.dataSources[0]!.value).toEqual([]);
    });

    it("adds an object data source", () => {
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "object" });
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
      expect(pack.dataSources[0]!.name).toBe("new_object");
      expect(pack.dataSources[0]!.type).toEqual({ kind: "object", fields: [] });
      expect(pack.dataSources[0]!.value).toEqual({});
    });

    it("disambiguates duplicate names", () => {
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "list" });
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "list" });
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
      expect(pack.dataSources[0]!.name).toBe("new_list");
      expect(pack.dataSources[1]!.name).toBe("new_list_2");
    });

    it("removes a data source by id", () => {
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "list" });
      const id = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!
        .dataSources[0]!.id;
      useAccountStore.getState().removePackDataSource({ packId: PERSONAL, id });
      expect(
        useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!.dataSources,
      ).toHaveLength(0);
    });

    it("renames a data source", () => {
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "list" });
      const id = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!
        .dataSources[0]!.id;
      useAccountStore
        .getState()
        .renamePackDataSource({ packId: PERSONAL, id, newName: "categories" });
      expect(
        useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!.dataSources[0]!
          .name,
      ).toBe("categories");
    });

    it("setValue writes the value", () => {
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "list" });
      const id = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!
        .dataSources[0]!.id;
      useAccountStore
        .getState()
        .setPackDataSourceValue({ packId: PERSONAL, id, value: ["weapon", "armor"] });
      expect(
        useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!.dataSources[0]!
          .value,
      ).toEqual(["weapon", "armor"]);
    });

    it("setSchema resets value to schema default", () => {
      useAccountStore.getState().addPackDataSource({ packId: PERSONAL, kind: "list" });
      const id = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!
        .dataSources[0]!.id;
      useAccountStore
        .getState()
        .setPackDataSourceValue({ packId: PERSONAL, id, value: ["x", "y"] });
      useAccountStore.getState().setPackDataSourceSchema({
        packId: PERSONAL,
        id,
        type: { kind: "object", fields: [{ name: "title", type: { kind: "string" } }] },
      });
      expect(
        useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!.dataSources[0]!
          .value,
      ).toEqual({ title: "" });
    });
  });

  it("createPack clears the temporal stack", () => {
    useAccountStore.getState().setSlotMaterial({
      packId: packId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "EMERALD",
    });
    useAccountStore.getState().createPack({ name: "Fresh" });
    // pastStates should be empty after createPack clears the stack
    expect(useAccountStore.temporal.getState().pastStates.length).toBe(0);
  });
});
