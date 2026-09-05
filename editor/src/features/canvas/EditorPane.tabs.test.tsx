import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/flow/FlowCanvas", () => ({ FlowCanvas: () => <div data-testid="flow" /> }));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div data-testid="assets" /> }));
vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("./useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("./Library", () => ({ Library: () => <div data-testid="library" /> }));
vi.mock("./CapturedItemsSection", () => ({ CapturedItemsSection: () => <div /> }));

import { EditorPane } from "./EditorPane";

const PID = "p1" as ProjectId;

beforeEach(() => {
  useSelectionStore.getState().clear();
  useUiStore.getState().setEditorTab("edit");
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
                { id: "L0", elements: [{ id: "el1", positions: "0", display: {}, states: [] }] },
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
          canvasLayout: {} as any,
        } as Project,
      ],
    },
  } as any);
});

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);

describe("EditorPane — onglets contextuels", () => {
  it("un menu sélectionné offre Bibliothèque et Assets", () => {
    useSelectionStore.getState().set(["m1"]);
    render(<EditorPane projectId={PID} />);
    expect(tabNames()).toHaveLength(3);
  });

  it("un élément de menu les offre aussi — on y dépose des items", () => {
    useSelectionStore.getState().set(["el1"], 0, "m1");
    render(<EditorPane projectId={PID} />);
    expect(tabNames()).toHaveLength(3);
  });

  /** On ne dépose ni item ni glyphe dans une commande. */
  it("une commande n'offre que l'onglet d'édition", () => {
    useSelectionStore.getState().set(["c1"]);
    render(<EditorPane projectId={PID} />);
    expect(tabNames()).toHaveLength(1);
    expect(screen.queryByTestId("library")).toBeNull();
  });

  /**
   * `editorTab` est persisté : quelqu'un qui revient en étant resté sur
   * « Bibliothèque » et sélectionne une commande verrait un onglet inexistant.
   */
  it("retombe sur l'édition quand l'onglet mémorisé n'est pas offert", () => {
    useUiStore.getState().setEditorTab("library");
    useSelectionStore.getState().set(["c1"]);
    render(<EditorPane projectId={PID} />);
    expect(screen.getByTestId("flow")).toBeInTheDocument();
    // La préférence n'est pas écrasée : elle reprend sur un menu.
    expect(useUiStore.getState().editorTab).toBe("library");
  });
});
