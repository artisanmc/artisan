import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LibraryDrawer } from "./LibraryDrawer";

vi.mock("@/features/canvas/Library", () => ({ Library: () => <div>LIBRARY_STUB</div> }));

describe("LibraryDrawer", () => {
  it("renders Library content when open", () => {
    render(<LibraryDrawer open onOpenChange={() => {}} />);
    expect(screen.getByText("LIBRARY_STUB")).toBeInTheDocument();
  });
  it("does NOT render Library content when closed", () => {
    render(<LibraryDrawer open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText("LIBRARY_STUB")).not.toBeInTheDocument();
  });
  it("calls onOpenChange(false) when overlay is clicked", () => {
    const handle = vi.fn();
    render(<LibraryDrawer open onOpenChange={handle} />);
    fireEvent.click(screen.getByTestId("library-drawer-overlay"));
    expect(handle).toHaveBeenCalledWith(false);
  });
});
