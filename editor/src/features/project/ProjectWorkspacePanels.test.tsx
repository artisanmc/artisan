import type { ProjectId } from "@/domain/types";
import { useUiStore } from "@/state/uiStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CanvasWithInspector } from "./CanvasWithInspector";
import { ProjectWorkspacePanels } from "./ProjectWorkspacePanels";

let inspecting = false;
vi.mock("./useInspector", () => ({ useInspector: () => ({ open: inspecting }) }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => true }));
vi.mock("./ProjectPanel", () => ({ ProjectPanel: () => <a href="#elements">Project elements</a> }));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div>Selection properties</div>,
}));
vi.mock("@/features/canvas/FloatingEditorPane", () => ({
  FloatingEditorPane: () => <div>Floating properties</div>,
}));
beforeEach(() => {
  inspecting = false;
  useUiStore.setState({ projectPanelOpen: true });
});
const projectId = "p1" as ProjectId;
function workspace(active = true) {
  return (
    <ProjectWorkspacePanels projectId={projectId} active={active}>
      <CanvasWithInspector
        projectId={projectId}
        canvas={<div>Canvas</div>}
        mobileSize={200}
        onMobileSizeChange={() => {}}
      />
    </ProjectWorkspacePanels>
  );
}
it("places properties before elements in separate full-height columns after the canvas", () => {
  const view = render(workspace());
  const canvas = screen.getByText("Canvas");
  expect(screen.queryByText("Selection properties")).toBeNull();
  inspecting = true;
  view.rerender(workspace());
  expect(screen.getByText("Canvas")).toBe(canvas);
  const elements = screen.getByText("Project elements");
  const properties = screen.getByText("Selection properties");
  expect(
    screen.getByText("Canvas").compareDocumentPosition(properties) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    properties.compareDocumentPosition(elements) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByText("Floating properties")).toBeNull();
  expect(elements.closest("aside")).not.toBe(properties.closest("aside"));
  for (const separator of screen.getAllByRole("separator")) {
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
  }
});
it("keeps properties when the tree is hidden, and releases the column when both are closed", () => {
  inspecting = true;
  const view = render(workspace());
  act(() => useUiStore.setState({ projectPanelOpen: false }));
  expect(screen.queryByText("Project elements")).toBeNull();
  expect(screen.getByText("Selection properties")).toBeInTheDocument();
  inspecting = false;
  view.rerender(workspace());
  expect(screen.queryByTestId("project-side-panel")).toBeNull();
});
it("keeps the tree but hides properties on secondary views", () => {
  inspecting = true;
  render(workspace(false));
  expect(screen.getByText("Project elements")).toBeInTheDocument();
  expect(screen.queryByText("Selection properties")).toBeNull();
  expect(screen.queryByText("Floating properties")).toBeNull();
});

it("reveals elements at the right edge without fixing them open, then closes after leaving", () => {
  vi.useFakeTimers();
  try {
    useUiStore.setState({ projectPanelOpen: false });
    inspecting = true;
    render(workspace());
    const properties = screen.getByText("Selection properties");
    expect(screen.queryByText("Project elements")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("project-elements-edge"));
    expect(screen.getByText("Project elements")).toBeInTheDocument();
    expect(useUiStore.getState().projectPanelOpen).toBe(false);
    expect(screen.getByTestId("project-elements-space")).toHaveAttribute("data-fixed", "false");
    expect(screen.getByText("Selection properties")).toBe(properties);
    fireEvent.mouseLeave(screen.getByTestId("project-elements-panel"));
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByText("Project elements")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("the toolbar toggle fixes a hovered panel open and the second click dismisses it", () => {
  vi.useFakeTimers();
  try {
    useUiStore.setState({ projectPanelOpen: false });
    render(workspace());
    fireEvent.mouseEnter(screen.getByTestId("project-elements-edge"));
    act(() => useUiStore.getState().toggleProjectPanel());
    fireEvent.mouseLeave(screen.getByTestId("project-elements-panel"));
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText("Project elements")).toBeInTheDocument();
    act(() => useUiStore.getState().toggleProjectPanel());
    expect(screen.queryByText("Project elements")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("starts in automatic mode", () => {
  expect(useUiStore.getInitialState().projectPanelOpen).toBe(false);
});

it("keeps the revealed panel open until its popup closes", async () => {
  vi.useFakeTimers();
  const popup = document.createElement("div");
  popup.setAttribute("role", "menu");
  try {
    useUiStore.setState({ projectPanelOpen: false });
    render(workspace());
    fireEvent.mouseEnter(screen.getByTestId("project-elements-edge"));
    act(() => {
      document.body.append(popup);
    });
    fireEvent.mouseLeave(screen.getByTestId("project-elements-panel"));
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText("Project elements")).toBeInTheDocument();
    await act(async () => {
      popup.remove();
    });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByText("Project elements")).toBeNull();
  } finally {
    popup.remove();
    vi.useRealTimers();
  }
});

it("preserves keyboard focus and returns it to the toggle on Escape", () => {
  vi.useFakeTimers();
  try {
    useUiStore.setState({ projectPanelOpen: false });
    render(
      <>
        <button type="button" data-project-elements-toggle>
          Elements toggle
        </button>
        {workspace()}
      </>,
    );
    fireEvent.mouseEnter(screen.getByTestId("project-elements-edge"));
    fireEvent.keyDown(window, { key: "Tab" });
    act(() => screen.getByText("Project elements").focus());
    fireEvent.mouseLeave(screen.getByTestId("project-elements-panel"));
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText("Project elements")).toHaveFocus();
    fireEvent.keyDown(screen.getByText("Project elements"), { key: "Escape" });
    expect(screen.queryByText("Project elements")).toBeNull();
    expect(screen.getByText("Elements toggle")).toHaveFocus();
  } finally {
    vi.useRealTimers();
  }
});
