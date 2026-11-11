import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";

import { Edges } from "./Edges";

vi.mock("react-konva", () => ({
  Arrow: (props: Record<string, unknown>) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: test stub of a Konva node (canvas, no keyboard); the div only relays fireEvent.click to the handler
    <div
      data-testid="konva-arrow"
      data-points={JSON.stringify(props.points)}
      onClick={() =>
        (props.onClick as ((e: { cancelBubble: boolean }) => void) | undefined)?.({
          cancelBubble: false,
        })
      }
    />
  ),
  Circle: (props: Record<string, unknown>) => (
    <div
      data-testid="konva-circle"
      data-x={props.x}
      data-y={props.y}
      onDoubleClick={() => (props.onDblClick as (() => void) | undefined)?.()}
    />
  ),
}));

vi.mock("@/lib/themeColors", () => ({ useCssVar: () => "#000000" }));

// Fixed edges — this test exercises routing/selection, not action-walking.
vi.mock("./deriveEdges", () => ({
  deriveEdges: () => [
    {
      id: "menu/m_shop_main->menu/m_profile",
      source: "menu/m_shop_main",
      target: "menu/m_profile",
      triggers: [],
    },
    {
      id: "menu/m_profile->menu/m_shop_main",
      source: "menu/m_profile",
      target: "menu/m_shop_main",
      triggers: [],
    },
  ],
}));

const PERSONAL = projectId("p_personal");
const layout = { "menu/m_shop_main": { x: 0, y: 0 }, "menu/m_profile": { x: 700, y: 0 } };
const getProject = () =>
  useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;

describe("Edges", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
    useEdgeSelectionStore.getState().select(null);
    useSelectionStore.getState().clear();
  });

  it("renders one arrow per edge with distinct anchors for A->B / B->A", () => {
    render(<Edges project={getProject()} layout={layout} />);
    const arrows = screen.getAllByTestId("konva-arrow");
    expect(arrows).toHaveLength(2);
    const p1 = JSON.parse(arrows[0]!.getAttribute("data-points")!) as number[];
    const p2 = JSON.parse(arrows[1]!.getAttribute("data-points")!) as number[];
    // a->b leaves m_shop_main's right side at a different y than b->a arrives
    expect(p1[1]).not.toBe(p2[7]);
  });

  it("click selects the edge, clears node selection, shows two handles", () => {
    useSelectionStore.getState().set(["menu/m_about"]);
    render(<Edges project={getProject()} layout={layout} />);
    fireEvent.click(screen.getAllByTestId("konva-arrow")[0]!);
    expect(useEdgeSelectionStore.getState().edgeId).toBe("menu/m_shop_main->menu/m_profile");
    expect(useSelectionStore.getState().ids.size).toBe(0);
    expect(screen.getAllByTestId("konva-circle")).toHaveLength(2);
  });

  it("double-click on a handle clears the override", () => {
    useProjectsStore.getState().setEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "menu/m_shop_main->menu/m_profile",
      end: "from",
      anchor: { side: "top", t: 0.2 },
    });
    render(<Edges project={getProject()} layout={layout} />);
    fireEvent.click(screen.getAllByTestId("konva-arrow")[0]!);
    fireEvent.doubleClick(screen.getAllByTestId("konva-circle")[0]!);
    expect(getProject().canvasEdges?.["menu/m_shop_main->menu/m_profile"]).toBeUndefined();
  });
});
