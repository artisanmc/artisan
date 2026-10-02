import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorTour } from "./EditorTour";
import { useTourPresentation } from "./tourPresentation";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 80, 100, 80),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useTourPresentation.setState({ step: null });
});

it("spotlights the demo Export action and finishes only on explicit confirmation", async () => {
  const user = userEvent.setup();
  const actions = { next: vi.fn(), back: vi.fn(), defer: vi.fn(), complete: vi.fn() };
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.tour === "demo-export"
      ? new DOMRect(600, 10, 120, 40)
      : new DOMRect(40, 80, 100, 80);
  });
  render(
    <>
      <button data-tour="save" type="button">
        Save
      </button>
      <button data-tour="demo-export" type="button">
        Export
      </button>
      <EditorTour
        state={{ open: true, step: 6, busy: false }}
        demo
        storage="demo"
        actions={actions}
      />
    </>,
  );
  await waitFor(() =>
    expect(document.querySelector("[data-tour-overlay] rect")).toHaveAttribute("x", "596"),
  );
  expect(actions.complete).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Terminer|Finish/ }));
  expect(actions.complete).toHaveBeenCalledOnce();
});

it("skips an unavailable target after layout settles without completing the final step", async () => {
  const actions = { next: vi.fn(), back: vi.fn(), defer: vi.fn(), complete: vi.fn() };
  const view = render(
    <EditorTour
      state={{ open: true, step: 2, busy: false }}
      demo
      storage="demo"
      actions={actions}
    />,
  );
  expect(actions.next).not.toHaveBeenCalled();
  await waitFor(() => expect(actions.next).toHaveBeenCalledOnce(), { timeout: 1200 });
  view.rerender(
    <EditorTour
      state={{ open: true, step: 6, busy: false }}
      demo
      storage="demo"
      actions={actions}
    />,
  );
  expect(screen.getByRole("button", { name: /Terminer|Finish/ })).toBeInTheDocument();
  expect(actions.complete).not.toHaveBeenCalled();
});

it("walks through six demo stops, explains Export, and cleans up presentation when deferred", async () => {
  const user = userEvent.setup();
  const complete = vi.fn();
  function Example() {
    const [step, setStep] = useState(0);
    const [open, setOpen] = useState(true);
    return (
      <>
        <div data-tour="demo-intro" />
        <div data-tour="canvas" />
        <div data-tour="library" />
        <div data-tour="elements" />
        <div data-tour="tabs" />
        <button type="button" data-tour="demo-export">
          Export
        </button>
        <EditorTour
          state={{ open, step, busy: false }}
          demo
          storage="demo"
          canUseAssistant={false}
          actions={{
            next: () => setStep(step + 1),
            back: () => setStep(step - 1),
            defer: () => setOpen(false),
            complete,
          }}
        />
      </>
    );
  }
  render(<Example />);
  await user.click(await screen.findByRole("button", { name: /Commencer|Let's go/ }));
  expect(
    await screen.findByRole("dialog", { name: /Un espace pour essayer|Your space to try things/ }),
  ).toBeInTheDocument();
  for (let step = 1; step < 6; step++)
    await user.click(screen.getByRole("button", { name: /Suivant|Next/ }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/Exporter ce projet|Export this project/);
  expect(complete).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Plus tard|Later/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useTourPresentation.getState().step).toBeNull();
});

it("waits for a higher-priority dialog to close before presenting the tour", async () => {
  const actions = { next: vi.fn(), back: vi.fn(), defer: vi.fn(), complete: vi.fn() };
  const blocker = document.createElement("div");
  blocker.setAttribute("role", "dialog");
  document.body.append(blocker);
  render(
    <EditorTour
      state={{ open: true, step: 0, busy: false }}
      demo
      storage="demo"
      actions={actions}
    />,
  );
  expect(screen.queryByRole("dialog", { name: /Découvrir Artisan|Discover Artisan/ })).toBeNull();
  await act(async () => blocker.remove());
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: /Découvrir Artisan|Discover Artisan/ }),
    ).toBeInTheDocument(),
  );
});
