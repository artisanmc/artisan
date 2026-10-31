import type { Project, ProjectId } from "@/domain/types";
import { useDocumentTrailStore } from "@/state/documentTrailStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { registerModule } from "@artisan/editor-sdk";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "../../../packages/editor-sdk/src/contract/registry";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ serverId: "s1", projectId: "p1", elementId: "m1" }),
  useSearch: () => ({}),
}));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div data-testid="focus-stage" /> }));
vi.mock("@/features/inspector/EditorPane", () => ({
  EditorPane: () => <div data-testid="editor-pane" />,
}));
vi.mock("@/features/inspector/SelectionInspector", () => ({
  SelectionInspector: () => <div data-testid="flow-canvas" />,
}));

import { DocumentView } from "./DocumentView";
import { ResolvedProjectContext } from "./ResolvedProjectContext";

const PID = "p1" as ProjectId;
beforeEach(() => {
  navigate.mockClear();
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
                  {
                    id: "L0",
                    elements: [
                      { id: "el1", positions: "13", display: { material: "DIAMOND" }, states: [] },
                    ],
                  },
                ],
              } as any,
            ],
            command: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
            dialog: [],
            quest_group: [{ id: "daily", projectId: PID } as any],
          },
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
  it("uses the parent anchor when another cached project has the same public folder ID", () => {
    const openProjects = useProjectsStore.getState().openProjects;
    const own = { ...openProjects.projects[0]!, diskId: "shared", serverKeyId: "s1" };
    const other = {
      ...own,
      id: "shared" as ProjectId,
      serverKeyId: "s2",
      documents: { menu: [], command: [] },
    };
    useProjectsStore.setState({ openProjects: { ...openProjects, projects: [other, own] } });
    render(
      <ResolvedProjectContext.Provider value={PID}>
        <DocumentView projectId={"shared" as ProjectId} documentId={"m1" as any} />
      </ResolvedProjectContext.Provider>,
    );
    expect(screen.getByTestId("focus-stage")).toBeInTheDocument();
    useDocumentTrailStore.getState().trail?.toProject();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { serverId: "s1", projectId: "shared" } }),
    );
  });
  it("opens a module's Document in its kind's view instead of 'not found'", () => {
    render(<DocumentView projectId={PID} documentId={"daily" as any} />);
    expect(screen.getByTestId("flow-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("focus-stage")).toBeNull();
  });
  it("opens a module's Document on its node when its kind lists parts on the board", () => {
    registerModule({
      id: "quests-test",
      documents: [{ kind: "quest_group", board: { items: () => [] } } as any],
    } as any);
    try {
      render(<DocumentView projectId={PID} documentId={"daily" as any} />);
      expect(screen.getByTestId("focus-stage")).toBeInTheDocument();
    } finally {
      clearRegistry();
    }
  });
  it("renders the focused stage + EditorPane for a menu", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect(screen.getByTestId("focus-stage")).toBeInTheDocument();
    expect(screen.getByTestId("editor-pane")).toBeInTheDocument();
  });
  it("hands its levels to the topbar's breadcrumb, the project leading back to the overview", () => {
    const { unmount } = render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    const trail = useDocumentTrailStore.getState().trail;
    expect(trail?.label).toBe("m1");
    expect(trail?.collection).toBeUndefined();
    trail?.toProject();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/servers/$serverId/projects/$projectId",
      }),
    );
    unmount();
    expect(useDocumentTrailStore.getState().trail).toBeNull();
  });
  it("Escape goes back to the canvas", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/servers/$serverId/projects/$projectId",
      }),
    );
  });
  it("Escape inside an input field does not navigate", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(navigate).not.toHaveBeenCalled();
    input.remove();
  });
  it("element not found → notFound", () => {
    render(<DocumentView projectId={PID} documentId={"zzz" as any} />);
    expect(screen.getByText(/no longer exists|n'existe plus/i)).toBeInTheDocument();
  });
  it("renders the centered flow editor for a command", () => {
    render(<DocumentView projectId={PID} documentId={"c1" as any} />);
    expect(screen.getByTestId("flow-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("document-body")).toHaveClass("max-w-5xl");
  });
  it("gives a wide module kind's view the whole width", () => {
    registerModule({
      id: "quests-test",
      documents: [{ kind: "quest_group", wide: true } as any],
    } as any);
    try {
      render(<DocumentView projectId={PID} documentId={"daily" as any} />);
      expect(screen.getByTestId("document-body")).not.toHaveClass("max-w-5xl");
    } finally {
      clearRegistry();
    }
  });
  it("selects the default menu when there is no relevant selection", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect([...useSelectionStore.getState().ids]).toEqual(["menu/m1"]);
  });
  it("preserves an already-set child selection (e.g. from search)", () => {
    // The search palette selects the item BEFORE DocumentView mounts.
    useSelectionStore.getState().set(["el1"], 13);
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect([...useSelectionStore.getState().ids]).toEqual(["el1"]);
    expect(useSelectionStore.getState().focusedSlot).toBe(13);
  });
});

// The Document's levels sit in the topbar's breadcrumb, and the edit panel takes the
// canvas's floating card.
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

  it("draws no bar of its own over the stage", () => {
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    expect(screen.queryByTestId("document-view-bubble")).toBeNull();
    expect(document.querySelector("header")).toBeNull();
  });

  it("on desktop, the editing panel floats above the stage", () => {
    setDesktop(true);
    render(<DocumentView projectId={PID} documentId={"m1" as any} />);
    const pane = document.querySelector('[role="separator"][aria-orientation="vertical"]');
    expect(pane).not.toBeNull();
    expect(pane!.closest("div.absolute")).not.toBeNull();
    setDesktop(false);
  });
});
