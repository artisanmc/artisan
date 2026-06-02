import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionBlock } from "./ActionBlock";

const openMenuAction = { type: "open_menu", menuId: "shop_menu" } as any;

describe("ActionBlock", () => {
  it("renders compact summary line in collapsed state", () => {
    render(
      <ActionBlock
        action={openMenuAction}
        packMenus={[{ id: "shop_menu", name: "Shop" } as any]}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/open_menu/i)).toBeInTheDocument();
    expect(screen.getByText(/Shop/i)).toBeInTheDocument();
  });

  it("expands to edit form when clicked", () => {
    render(<ActionBlock action={openMenuAction} packMenus={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("action-block-summary"));
    expect(screen.getByTestId("action-block-form")).toBeInTheDocument();
  });

  it("collapses when Escape is pressed in expanded state", () => {
    render(<ActionBlock action={openMenuAction} packMenus={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("action-block-summary"));
    fireEvent.keyDown(screen.getByTestId("action-block-form"), { key: "Escape" });
    expect(screen.queryByTestId("action-block-form")).not.toBeInTheDocument();
  });
});
