import { menuId, packId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

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
});
