import { packId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { InventoryGrid } from "./InventoryGrid";

describe("<InventoryGrid />", () => {
  beforeEach(() => {
    const menu = mockAccount().packs[0]!.menus[0]!;
    useMenuDraftStore.getState().load({ menu, packId: packId("p_personal") });
  });

  it("renders rows × 9 slots", () => {
    render(
      <DndContext>
        <InventoryGrid />
      </DndContext>,
    );
    expect(screen.getAllByTestId(/^slot-/)).toHaveLength(27);
  });
});
