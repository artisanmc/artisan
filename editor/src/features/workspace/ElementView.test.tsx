import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ networkId: "n1", serverId: "s1", workspaceId: "p1", elementId: "m1" }),
}));
vi.mock("./SoloMenuStage", () => ({ SoloMenuStage: () => <div data-testid="solo-menu" /> }));
vi.mock("@/features/canvas/EditorPane", () => ({ EditorPane: () => <div data-testid="editor-pane" /> }));
vi.mock("@/features/flow/FlowCanvas", () => ({ FlowCanvas: () => <div data-testid="flow-canvas" /> }));

import { ElementView } from "./ElementView";

const PID = "p1" as PackId;
beforeEach(() => {
  navigate.mockClear();
  useSelectionStore.getState().clear();
  useAccountStore.setState({ account: { id: "a" as any, packOrder: [PID], packs: [{
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [
      { id: "L0", elements: [{ id: "el1", positions: "13", appearances: [{ material: "DIAMOND" }] }] },
    ] } as any],
    commands: [{ id: "c1", packId: PID, name: "heal", arguments: [], steps: [] } as any], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: {},
  } as Pack] } } as any);
});

describe("ElementView", () => {
  it("rend SoloMenuStage + EditorPane pour un menu", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    expect(screen.getByTestId("solo-menu")).toBeInTheDocument();
    expect(screen.getByTestId("editor-pane")).toBeInTheDocument();
  });
  it("le bouton retour navigue vers l'overview", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    fireEvent.click(screen.getByText(/back to canvas|retour au canvas/i));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
    }));
  });
  it("affiche le badge clavier Esc sur le bouton retour", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });
  it("Echap revient au canvas", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
    }));
  });
  it("Echap dans un champ de saisie ne navigue pas", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(navigate).not.toHaveBeenCalled();
    input.remove();
  });
  it("élément introuvable → notFound", () => {
    render(<ElementView packId={PID} elementId={"zzz" as any} />);
    expect(screen.getByText(/no longer exists|n'existe plus/i)).toBeInTheDocument();
  });
  it("rend l'éditeur de flux centré pour une commande", () => {
    render(<ElementView packId={PID} elementId={"c1" as any} />);
    expect(screen.getByTestId("flow-canvas")).toBeInTheDocument();
  });
  it("sélectionne le menu par défaut quand aucune sélection pertinente", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    expect([...useSelectionStore.getState().ids]).toEqual(["m1"]);
  });
  it("préserve une sélection d'enfant déjà posée (ex. depuis la recherche)", () => {
    // La palette de recherche sélectionne l'item AVANT que ElementView ne monte.
    useSelectionStore.getState().set(["el1"], 13);
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    expect([...useSelectionStore.getState().ids]).toEqual(["el1"]);
    expect(useSelectionStore.getState().focusedSlot).toBe(13);
  });
});
