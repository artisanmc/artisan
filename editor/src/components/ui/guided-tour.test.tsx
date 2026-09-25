import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { GuidedTour } from "./guided-tour";

const labels = {
  next: "Suivant",
  previous: "Précédent",
  defer: "Plus tard",
  progress: "Étape 2 sur 6",
};

describe("GuidedTour", () => {
  it("blocks application keyboard shortcuts while the tour is open", async () => {
    const user = userEvent.setup();
    const appShortcut = vi.fn();
    window.addEventListener("keydown", appShortcut);
    try {
      render(
        <GuidedTour
          open
          title="Le canvas"
          description="Reliez vos menus."
          step={2}
          totalSteps={6}
          labels={labels}
          onNext={vi.fn()}
          onDefer={vi.fn()}
        />,
      );
      await user.keyboard("{Delete}2");
      expect(appShortcut).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", appShortcut);
    }
  });
  it("keeps keyboard focus inside the tour and restores it when deferred with Escape", async () => {
    const user = userEvent.setup();
    const deferred = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Découvrir
          </button>
          <GuidedTour
            open={open}
            title="Le canvas"
            description="Reliez vos menus."
            step={2}
            totalSteps={6}
            labels={labels}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
            onDefer={() => {
              deferred();
              setOpen(false);
            }}
          />
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Découvrir" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Le canvas" });
    expect(dialog).toHaveAccessibleDescription("Reliez vos menus.");
    expect(screen.getByText("Étape 2 sur 6")).toBeInTheDocument();
    for (let index = 0; index < 5; index++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    const appShortcut = vi.fn();
    window.addEventListener("keydown", appShortcut);
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", appShortcut);
    expect(appShortcut).not.toHaveBeenCalled();
    expect(deferred).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it("keeps a small-screen callout below a top target and ignores outside clicks", async () => {
    const user = userEvent.setup();
    const defer = vi.fn();
    const target = document.createElement("button");
    target.getBoundingClientRect = () => new DOMRect(8, 8, 340, 60);
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 667 });
    render(
      <GuidedTour
        open
        target={target}
        title="Navigation"
        description="Vos projets."
        step={1}
        totalSteps={6}
        labels={labels}
        onNext={vi.fn()}
        onDefer={defer}
      />,
    );
    await user.click(document.querySelector("[data-tour-overlay]")!);
    expect(defer).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThan(68);
    expect(Number.parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(351);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  });
});
