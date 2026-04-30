import { packId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";
import { useMenuDraftStore } from "./menuDraftStore";

describe("menuDraftStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
    const menu = useAccountStore.getState().account.packs[0]!.menus[0]!;
    useMenuDraftStore.getState().load({ menu, packId: packId("p_personal") });
  });

  it("setMaterialAtPosition updates an existing element", () => {
    useMenuDraftStore.getState().setMaterialAtPosition({ position: 13, material: "DIAMOND" });
    const draft = useMenuDraftStore.getState().draft!;
    const el = draft.layers[0]!.elements.find((e) => e.positions === "13")!;
    expect(el.appearances[0]!.material).toBe("DIAMOND");
  });

  it("setMaterialAtPosition creates an element at an empty position", () => {
    useMenuDraftStore.getState().setMaterialAtPosition({ position: 22, material: "PAPER" });
    const draft = useMenuDraftStore.getState().draft!;
    const el = draft.layers[0]!.elements.find((e) => e.positions === "22")!;
    expect(el.appearances[0]!.material).toBe("PAPER");
  });

  it("commit writes the draft back to the account store", () => {
    useMenuDraftStore.getState().setMaterialAtPosition({ position: 13, material: "GOLD_INGOT" });
    useMenuDraftStore.getState().commit();
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!;
    const el = updated.layers[0]!.elements.find((e) => e.positions === "13")!;
    expect(el.appearances[0]!.material).toBe("GOLD_INGOT");
  });
});
