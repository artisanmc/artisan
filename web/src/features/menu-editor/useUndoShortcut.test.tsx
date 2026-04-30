import { packId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUndoShortcut } from "./useUndoShortcut";

describe("useUndoShortcut", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
    const menu = useAccountStore.getState().account.packs[0]!.menus[0]!;
    useMenuDraftStore.getState().load({ menu, packId: packId("p_personal") });
  });

  it("Ctrl+Z reverts the last setMaterialAtPosition", () => {
    renderHook(() => useUndoShortcut());

    useMenuDraftStore.getState().setMaterialAtPosition({ position: 0, material: "DIAMOND" });
    expect(
      useMenuDraftStore.getState().draft!.layers[0]!.elements.find((e) => e.positions === "0")
        ?.appearances[0]!.material,
    ).toBe("DIAMOND");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));

    const stillThere = useMenuDraftStore
      .getState()
      .draft!.layers[0]!.elements.find((e) => e.positions === "0");
    expect(stillThere?.appearances[0]?.material).not.toBe("DIAMOND");
  });
});
