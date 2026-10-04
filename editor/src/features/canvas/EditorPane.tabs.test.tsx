import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/flow/FlowCanvas", () => ({ FlowCanvas: () => <div data-testid="flow" /> }));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div data-testid="assets" /> }));
vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("./useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("./Library", () => ({ Library: () => <div data-testid="library" /> }));
vi.mock("./CapturedItemsSection", () => ({ CapturedItemsSection: () => <div /> }));
vi.mock("@/features/project/DocumentYamlView", async (orig) => ({
  ...(await orig<object>()),
  DocumentYamlView: ({ relPath }: { relPath: string }) => <div data-testid="yaml">{relPath}</div>,
}));

import { EditorPane } from "./EditorPane";

const PID = "p1" as ProjectId;

beforeEach(() => {
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

describe("EditorPane — propriétés uniquement", () => {
  it("un menu sélectionné affiche ses propriétés sans catalogue ni onglets", () => {
    useSelectionStore.getState().set(["m1"]);
    render(<EditorPane projectId={PID} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId("flow")).toBeInTheDocument();
    expect(screen.queryByTestId("library")).toBeNull();
    expect(screen.queryByTestId("assets")).toBeNull();
  });

  it("un élément de menu affiche ses propriétés sans onglets", () => {
    useSelectionStore.getState().set(["el1"], 0, "m1");
    render(<EditorPane projectId={PID} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  /** On ne dépose ni item ni glyphe dans une commande. */
  it("une commande affiche ses propriétés sans catalogue", () => {
    useSelectionStore.getState().set(["c1"]);
    render(<EditorPane projectId={PID} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByTestId("library")).toBeNull();
  });

  it("affiche directement les propriétés d'une commande", () => {
    useSelectionStore.getState().set(["c1"]);
    render(<EditorPane projectId={PID} />);
    expect(screen.getByTestId("flow")).toBeInTheDocument();
  });
});

/**
 * Les paramètres du project survivent à une sélection vide — c'est ce qui les
 * distingue d'une sélection — donc ils avaient besoin d'une sortie explicite.
 */
describe("EditorPane — fermeture", () => {
  it("la croix vide la sélection et referme les paramètres du projet", () => {
    useUiStore.getState().setProjectSettingsOpen(true);
    useSelectionStore.getState().set(["m1"]);
    render(<EditorPane projectId={PID} />);

    fireEvent.click(screen.getByTestId("editor-pane-close"));

    expect(useSelectionStore.getState().ids.size).toBe(0);
    expect(useUiStore.getState().projectSettingsOpen).toBe(false);
  });
});

describe("EditorPane — mode YAML", () => {
  it("remplace les propriétés par le fichier du document de la sélection", () => {
    useSelectionStore.getState().set(["el1"], 0, "m1");
    render(<EditorPane projectId={PID} />);

    fireEvent.click(screen.getByTestId("editor-pane-yaml"));

    expect(screen.getByTestId("yaml")).toHaveTextContent("menus/m1.yaml");
    expect(screen.queryByTestId("flow")).toBeNull();
  });

  it("pas de bascule sans document sélectionné", () => {
    render(<EditorPane projectId={PID} />);
    expect(screen.queryByTestId("editor-pane-yaml")).toBeNull();
  });
});
