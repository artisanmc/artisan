import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssetsDrawer } from "./AssetsDrawer";

vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div>ASSETS_STUB</div> }));

describe("AssetsDrawer", () => {
  it("renders Assets content when open", () => {
    render(<AssetsDrawer open onOpenChange={() => {}} packId={"p1" as any} />);
    expect(screen.getByText("ASSETS_STUB")).toBeInTheDocument();
  });
  it("does NOT render when closed", () => {
    render(<AssetsDrawer open={false} onOpenChange={() => {}} packId={"p1" as any} />);
    expect(screen.queryByText("ASSETS_STUB")).not.toBeInTheDocument();
  });
  it("calls onOpenChange(false) when overlay is clicked", () => {
    const handle = vi.fn();
    render(<AssetsDrawer open onOpenChange={handle} packId={"p1" as any} />);
    fireEvent.click(screen.getByTestId("assets-drawer-overlay"));
    expect(handle).toHaveBeenCalledWith(false);
  });
});
