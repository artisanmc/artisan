import type { Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/inspector/SelectionInspector", () => ({
  SelectionInspector: () => <div data-testid="flow" />,
}));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div data-testid="assets" /> }));
vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/features/canvas/Library", () => ({ Library: () => <div data-testid="library" /> }));
vi.mock("@/features/canvas/CapturedItemsSection", () => ({ CapturedItemsSection: () => <div /> }));
vi.mock("@/features/project/DocumentYamlView", async (orig) => ({
  ...(await orig<object>()),
  DocumentYamlView: ({ relPath }: { relPath: string }) => <div data-testid="yaml">{relPath}</div>,
}));

import { EditorPane } from "./EditorPane";

const PID = "p1" as ProjectId;

beforeEach(() => {
  useSelectionStore.getState().clear();
  useProjectsStore.setState({
    openProjects: {
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          documents: {
            menu: [
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
            command: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
            dialog: [],
          },
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

describe("EditorPane — properties only", () => {
  it("a selected menu shows its properties with no catalog or tabs", () => {
    useSelectionStore.getState().set(["m1"]);
    render(<EditorPane projectId={PID} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId("flow")).toBeInTheDocument();
    expect(screen.queryByTestId("library")).toBeNull();
    expect(screen.queryByTestId("assets")).toBeNull();
  });

  it("a menu element shows its properties with no tabs", () => {
    useSelectionStore.getState().set(["el1"], 0, "m1");
    render(<EditorPane projectId={PID} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  /** No item or glyph is dropped into a command. */
  it("a command shows its properties with no catalog", () => {
    useSelectionStore.getState().set(["c1"]);
    render(<EditorPane projectId={PID} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByTestId("library")).toBeNull();
  });

  it("shows a command's properties directly", () => {
    useSelectionStore.getState().set(["c1"]);
    render(<EditorPane projectId={PID} />);
    expect(screen.getByTestId("flow")).toBeInTheDocument();
  });
});

/**
 * Project settings survive an empty selection — that is what sets them apart
 * from a selection — so they needed an explicit way out.
 */
describe("EditorPane — fermeture", () => {
  it("the cross clears the selection and closes the project settings", () => {
    useUiStore.getState().setProjectSettingsOpen(true);
    useSelectionStore.getState().set(["m1"]);
    render(<EditorPane projectId={PID} />);

    fireEvent.click(screen.getByTestId("editor-pane-close"));

    expect(useSelectionStore.getState().ids.size).toBe(0);
    expect(useUiStore.getState().projectSettingsOpen).toBe(false);
  });
});

describe("EditorPane — mode YAML", () => {
  it("replaces the properties with the file of the selection's document", () => {
    useSelectionStore.getState().set(["el1"], 0, "m1");
    render(<EditorPane projectId={PID} />);

    fireEvent.click(screen.getByTestId("editor-pane-yaml"));

    expect(screen.getByTestId("yaml")).toHaveTextContent("menus/m1.yaml");
    expect(screen.queryByTestId("flow")).toBeNull();
  });

  it("the project settings open the manifest", () => {
    useUiStore.getState().setProjectSettingsOpen(true);
    render(<EditorPane projectId={PID} />);

    fireEvent.click(screen.getByTestId("editor-pane-yaml"));

    expect(screen.getByTestId("yaml")).toHaveTextContent("manifest.yaml");
  });

  it("no toggle without a selected document", () => {
    useUiStore.getState().setProjectSettingsOpen(false);
    render(<EditorPane projectId={PID} />);
    expect(screen.queryByTestId("editor-pane-yaml")).toBeNull();
  });
});
