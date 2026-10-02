import type { ProjectId } from "@/domain/types";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CanvasWithInspector } from "./CanvasWithInspector";
import { ProjectWorkspacePanels } from "./ProjectWorkspacePanels";

vi.mock("@/lib/usePanelPresence", () => ({
  usePanelPresence: (open: boolean) => ({ mounted: open, expanded: open }),
}));

let inspecting = false;
vi.mock("./useInspector", () => ({ useInspector: () => ({ open: inspecting }) }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => true }));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div>Selection properties</div>,
}));
vi.mock("@/features/canvas/FloatingEditorPane", () => ({
  FloatingEditorPane: () => <div>Floating properties</div>,
}));
beforeEach(() => {
  inspecting = false;
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

it("docks the properties in a full-height column after the canvas, and nothing else on the right", () => {
  const view = render(workspace());
  const canvas = screen.getByText("Canvas");
  expect(screen.queryByText("Selection properties")).toBeNull();
  inspecting = true;
  view.rerender(workspace());
  expect(screen.getByText("Canvas")).toBe(canvas);
  const properties = screen.getByText("Selection properties");
  expect(
    canvas.compareDocumentPosition(properties) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByText("Floating properties")).toBeNull();
  // The project's documents live in the left sidebar now: no right column for them.
  expect(screen.queryByTestId("project-elements-panel")).toBeNull();
  expect(screen.queryByTestId("project-elements-edge")).toBeNull();
  for (const separator of screen.getAllByRole("separator")) {
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
  }
});

it("releases the column when nothing is inspected", () => {
  inspecting = true;
  const view = render(workspace());
  expect(screen.getByText("Selection properties")).toBeInTheDocument();
  inspecting = false;
  view.rerender(workspace());
  expect(screen.queryByTestId("project-side-panel")).toBeNull();
});

it("hides properties on secondary views", () => {
  inspecting = true;
  render(workspace(false));
  expect(screen.queryByText("Selection properties")).toBeNull();
  expect(screen.queryByText("Floating properties")).toBeNull();
});
