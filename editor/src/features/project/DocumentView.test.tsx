import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ networkId: "n1", serverId: "s1", projectId: "p1", elementId: "m1" }),
}));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div data-testid="focus-stage" /> }));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div data-testid="editor-pane" />,
}));
vi.mock("@/features/flow/FlowCanvas", () => ({
  FlowCanvas: () => <div data-testid="flow-canvas" />,
}));

import { DocumentView } from "./DocumentView";

const PID = "p1" as ProjectId;
beforeEach(() => {
  navigate.mockClear();
  useSelectionStore.getState().clear();
  useAccountStore.setState({
    account: {
      id: "a" as any,
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [
            {
              id: "m1",
              projectId: PID,
              title: [],
              rows: 3,
              layers: [
                {
                  id: "L0",
                  elements: [
                    { id: "el1", positions: "13", display: { material: "DIAMOND" }, states: [] },
                  ],
                },
              ],
            } as any,
          ],
          commands: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
          dialogs: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys: {},
          defaultLang: "en",
          canvasLayout: {},
        } as Project,
      ],
    },
  } as any);
});

describe("DocumentView", () => {
  it("rend le stage focalisé + EditorPane pour un menu", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect(screen.getByTestId("focus-stage")).toBeInTheDocument();
    expect(screen.getByTestId("editor-pane")).toBeInTheDocument();
  });
  it("le bouton retour navigue vers l'overview", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    fireEvent.click(screen.getByText(/back to canvas|retour au canvas/i));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/networks/$networkId/servers/$serverId/projects/$projectId",
      }),
    );
  });
  it("affiche le badge clavier Esc sur le bouton retour", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });
  it("Echap revient au canvas", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/networks/$networkId/servers/$serverId/projects/$projectId",
      }),
    );
  });
  it("Echap dans un champ de saisie ne navigue pas", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(navigate).not.toHaveBeenCalled();
    input.remove();
  });
  it("élément introuvable → notFound", () => {
    render(<DocumentView projectId={PID} documentId={"zzz" as any} />);
    expect(screen.getByText(/no longer exists|n'existe plus/i)).toBeInTheDocument();
  });
  it("rend l'éditeur de flux centré pour une commande", () => {
    render(<DocumentView projectId={PID} documentId={"c1" as any} />);
    expect(screen.getByTestId("flow-canvas")).toBeInTheDocument();
  });
  it("sélectionne le menu par défaut quand aucune sélection pertinente", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect([...useSelectionStore.getState().ids]).toEqual(["m1"]);
  });
  it("préserve une sélection d'enfant déjà posée (ex. depuis la recherche)", () => {
    // La palette de recherche sélectionne l'item AVANT que DocumentView ne monte.
    useSelectionStore.getState().set(["el1"], 13);
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect([...useSelectionStore.getState().ids]).toEqual(["el1"]);
    expect(useSelectionStore.getState().focusedSlot).toBe(13);
  });
});

// La topbar pleine largeur est remplacée par une bulle flottante au même
// endroit, et le panneau d'édition reprend la carte flottante du canvas.
describe("DocumentView — chrome flottant", () => {
  function setDesktop(matches: boolean) {
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it("le retour vit dans une bulle flottante, pas dans une barre qui prend la largeur", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    const bubble = screen.getByTestId("document-view-bubble");
    expect(bubble.className).toContain("absolute");
    expect(bubble.className).toContain("backdrop-blur");
    // Aucune <header> en flux qui réserverait de la hauteur.
    expect(document.querySelector("header")).toBeNull();
  });

  it("en desktop, le panneau d'édition flotte au-dessus de la scène", () => {
    setDesktop(true);
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    const pane = document.querySelector('[role="separator"][aria-orientation="vertical"]');
    expect(pane).not.toBeNull();
    expect(pane!.closest("div.absolute")).not.toBeNull();
    setDesktop(false);
  });
});
