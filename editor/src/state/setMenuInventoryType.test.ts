import { type menuId, projectId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";
import { menusOf } from "@/domain/documents";

const PERSONAL = projectId("p_personal");

const getMenu = (mId: ReturnType<typeof menuId>) =>
  menusOf(useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!).find(
    (m) => m.id === mId,
  )!;

describe("setMenuField inventoryType (keep+warn)", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
  });

  it("switches to hopper without throwing and keeps out-of-range elements", () => {
    const mId = useAccountStore
      .getState()
      .createMenu({ projectId: PERSONAL, id: "m_inv", rows: 6 });
    // Position 30 is valid for a 6-row chest (0-53) but out of range for a
    // 5-slot hopper (0-4).
    useAccountStore
      .getState()
      .setSlotMaterial({ projectId: PERSONAL, menuId: mId, position: 30, material: "PAPER" });

    const before = getMenu(mId).layers[0]!.elements.length;
    expect(before).toBeGreaterThan(0);

    expect(() =>
      useAccountStore.getState().setMenuField({
        projectId: PERSONAL,
        menuId: mId,
        field: "inventoryType",
        value: "hopper",
      }),
    ).not.toThrow();

    const menu = getMenu(mId);
    expect(menu.inventoryType).toBe("hopper");
    // Keep semantics: the out-of-range element is still present.
    expect(menu.layers[0]!.elements.length).toBe(before);
  });

  it("dropper then back to chest leaves inventoryType undefined (absent = chest)", () => {
    const mId = useAccountStore
      .getState()
      .createMenu({ projectId: PERSONAL, id: "m_inv2", rows: 6 });

    useAccountStore
      .getState()
      .setMenuField({ projectId: PERSONAL, menuId: mId, field: "inventoryType", value: "dropper" });
    expect(getMenu(mId).inventoryType).toBe("dropper");

    useAccountStore
      .getState()
      .setMenuField({ projectId: PERSONAL, menuId: mId, field: "inventoryType", value: "chest" });
    expect(getMenu(mId).inventoryType).toBeUndefined();
  });
});
