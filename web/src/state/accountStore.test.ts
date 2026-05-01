import { elementId, menuId, packId } from "@/domain/ids";
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

  it("moveMenuToPack moves the menu and keeps packs hermetic", () => {
    const fromId = packId("p_personal");
    const toId = packId("p_shop_system");
    // m_about is a leaf menu with no inbound references in p_personal,
    // so moving it leaves both source and target hermetic.
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

  it("moveMenuToPack rejects when destination would break hermeticity", () => {
    const fromId = packId("p_personal");
    const toId = packId("p_shop_system");
    const sourceMenu = menuId("m_shop_main");

    expect(() =>
      useAccountStore
        .getState()
        .moveMenuToPack({ menuId: sourceMenu, fromPackId: fromId, toPackId: toId }),
    ).toThrow(/cross-pack open_menu/);

    const a = useAccountStore.getState().account;
    expect(a.packs.find((p) => p.id === fromId)!.menus.some((m) => m.id === sourceMenu)).toBe(true);
  });

  it("deleteFromPack removes a leaf menu and its canvas position", () => {
    const pId = packId("p_personal");
    useAccountStore.getState().deleteFromPack({ packId: pId, nodeIds: ["m_about"] });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === pId)!;
    expect(pack.menus.some((m) => m.id === "m_about")).toBe(false);
    expect("m_about" in pack.canvasLayout).toBe(false);
  });

  it("deleteFromPack rejects when removed menu has inbound refs", () => {
    const pId = packId("p_personal");
    expect(() =>
      useAccountStore.getState().deleteFromPack({ packId: pId, nodeIds: ["m_profile"] }),
    ).toThrow(/cross-pack open_menu/);
    // Source unchanged.
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === pId)!;
    expect(pack.menus.some((m) => m.id === "m_profile")).toBe(true);
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
