import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
let searchOpen = false;

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/state/uiStore", () => ({
  useUiStore: { getState: () => ({ searchOpen }) },
}));

import { useWorkspaceTabShortcuts } from "./useWorkspaceTabShortcuts";

function Harness() {
  useWorkspaceTabShortcuts();
  return <input data-testid="field" />;
}

/** Resolve navigate's search updater against a prior search object. */
const resolvedSearch = (prev: object = {}) => {
  const arg = navigate.mock.calls[0]?.[0] as { search: (p: object) => object } | undefined;
  return arg?.search(prev);
};

function pressOnWindow(code: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, ...opts }));
}

describe("useWorkspaceTabShortcuts", () => {
  beforeEach(() => {
    navigate.mockClear();
    searchOpen = false;
  });

  it("Digit1 returns to the canvas (clears ?tab)", () => {
    render(<Harness />);
    pressOnWindow("Digit1");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(resolvedSearch({ keep: 1 })).toEqual({ keep: 1, tab: undefined });
  });

  it("Digit3 opens Data (data-sources), Numpad3 too", () => {
    render(<Harness />);
    pressOnWindow("Digit3");
    expect(resolvedSearch()).toEqual({ tab: "data-sources" });
    navigate.mockClear();
    pressOnWindow("Numpad3");
    expect(resolvedSearch()).toEqual({ tab: "data-sources" });
  });

  it("fires on the physical key regardless of the produced character (AZERTY-safe)", () => {
    render(<Harness />);
    // On AZERTY the unshifted Digit2 key yields "é", not "2" — we key off e.code.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: "é" }));
    expect(resolvedSearch()).toEqual({ tab: "translations" });
  });

  it("ignores digits when a modifier is held", () => {
    render(<Harness />);
    pressOnWindow("Digit2", { ctrlKey: true });
    pressOnWindow("Digit2", { metaKey: true });
    pressOnWindow("Digit2", { shiftKey: true });
    pressOnWindow("Digit2", { altKey: true });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores out-of-range digits (only 1-5 map to a tab)", () => {
    render(<Harness />);
    pressOnWindow("Digit6");
    pressOnWindow("Digit9");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores keystrokes while typing in a field", () => {
    const { getByTestId } = render(<Harness />);
    const field = getByTestId("field");
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", bubbles: true }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores keystrokes while the search palette is open", () => {
    searchOpen = true;
    render(<Harness />);
    pressOnWindow("Digit2");
    expect(navigate).not.toHaveBeenCalled();
  });
});
