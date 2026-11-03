import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageTour } from "./PageTour";

const steps = [
  { target: "flow", title: "Le déroulé", description: "La conversation lue de haut en bas." },
  { title: "Simuler", description: "Joue-la sans serveur." },
];

describe("PageTour", () => {
  it("walks the module's steps, then closes on the last one", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <div data-tour="flow">déroulé</div>
        <PageTour open steps={steps} onClose={onClose} />
      </>,
    );
    expect(screen.getByText("Le déroulé")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /next|suivant/i }));
    expect(screen.getByText("Simuler")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /previous|précédent/i }));
    expect(screen.getByText("Le déroulé")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /next|suivant/i }));
    await user.click(screen.getByRole("button", { name: /finish|terminer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from its close button, and draws nothing without steps", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<PageTour open steps={steps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /^(close|fermer)$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<PageTour open steps={[]} onClose={onClose} />);
    expect(screen.queryByText("Le déroulé")).toBeNull();
  });
});
