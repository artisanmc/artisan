import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CanvasToolbar } from "./CanvasToolbar";

describe("CanvasToolbar", () => {
  it("leaves the minimap toggle to the library tools", () => {
    render(<CanvasToolbar />);
    expect(screen.queryByRole("button", { name: /minimap/i })).toBeNull();
  });
  beforeEach(() => useUiStore.setState({ canvasMode: "select" }));
  it("rend les 2 modes et marque l'actif via aria-pressed", () => {
    render(<CanvasToolbar />);
    const sel = screen.getByRole("button", { name: /select|sélection/i });
    const hand = screen.getByRole("button", { name: /pan|navigation/i });
    expect(sel).toHaveAttribute("aria-pressed", "true");
    expect(hand).toHaveAttribute("aria-pressed", "false");
  });
  it("cliquer un mode le sélectionne", () => {
    render(<CanvasToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /pan|navigation/i }));
    expect(useUiStore.getState().canvasMode).toBe("hand");
  });
  it("filtre les types de Document : chaque bouton bascule l'atténuation de son type", () => {
    useUiStore.setState({ canvasHiddenKinds: [] });
    render(<CanvasToolbar onRearrange={() => {}} />);
    const commands = screen.getByRole("button", { name: /^(Commandes|Commands)$/ });
    expect(commands).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(commands);
    expect(useUiStore.getState().canvasHiddenKinds).toEqual(["command"]);
    expect(commands).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(commands);
    expect(useUiStore.getState().canvasHiddenKinds).toEqual([]);
  });
  it("n'affiche pas les filtres en vue focus (un seul Document)", () => {
    render(<CanvasToolbar />);
    expect(screen.queryByRole("button", { name: /^(Commandes|Commands)$/ })).toBeNull();
  });
  it("propose la dropdown de modes quand onRearrange est fourni", () => {
    render(<CanvasToolbar onRearrange={() => {}} />);
    expect(screen.getByRole("button", { name: /rearrange|réarranger/i })).toBeInTheDocument();
  });
});
