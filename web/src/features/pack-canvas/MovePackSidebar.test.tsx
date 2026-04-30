import { packId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MovePackSidebar } from "./MovePackSidebar";

describe("<MovePackSidebar />", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
  });

  it("lists every pack except the current one as a drop target", () => {
    render(
      <DndContext>
        <MovePackSidebar currentPackId={packId("p_personal")} />
      </DndContext>,
    );
    expect(screen.getByTestId("drop-target-p_shop_system")).toBeInTheDocument();
    expect(screen.getByTestId("drop-target-p_daily_quests")).toBeInTheDocument();
    expect(screen.queryByTestId("drop-target-p_personal")).not.toBeInTheDocument();
  });
});
