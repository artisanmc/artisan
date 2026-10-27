import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

function Nested() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Item</DialogTitle>
        <Popover>
          <PopoverTrigger>open</PopoverTrigger>
          <PopoverContent>
            <button type="button">inside</button>
          </PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>
  );
}

// One dismissable layer stack for both: a click in a popover opened from a dialog
// is inside the dialog's layer, not outside it.
describe("Popover in a Dialog", () => {
  it("keeps the dialog open when the popover is clicked", async () => {
    render(<Nested />);
    fireEvent.click(screen.getByText("open"));
    const inside = await screen.findByText("inside");
    fireEvent.pointerDown(inside);
    fireEvent.click(inside);
    expect(screen.getByText("Item")).toBeTruthy();
  });
});
