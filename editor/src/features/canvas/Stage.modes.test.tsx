import type { Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { act, render, renderHook, screen } from "@testing-library/react";
import type Konva from "konva";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Stage } from "./Stage";
import { useMarqueeSelection } from "./useMarqueeSelection";

vi.mock("react-konva", () => ({
  Stage: (p: any) => (
    <div data-testid="konva-stage" data-draggable={String(!!p.draggable)}>
      {p.children}
    </div>
  ),
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => <div data-name={p.name}>{p.children}</div>,
  Rect: () => <div />,
  Image: () => <div />,
  Text: () => <div />,
  Line: () => <div />,
  Transformer: () => <div />,
  Arrow: () => <div />,
  Circle: () => <div />,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));
vi.mock("./title/composer/TitleRender", () => ({ TitleRender: () => <div /> }));
vi.mock("./Edges", () => ({ Edges: () => <div /> }));

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: { menu: [], command: [], dialog: [] },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as Project;
}
describe("Stage — modes", () => {
  beforeEach(() =>
    useProjectsStore.setState({
      openProjects: { projects: [project()], projectOrder: [PID] },
    } as any),
  );
  it("hand mode → stage draggable", () => {
    useUiStore.setState({ canvasMode: "hand" } as any);
    render(<Stage projectId={PID} />);
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("true");
  });
  it("select mode → stage NOT draggable", () => {
    useUiStore.setState({ canvasMode: "select" } as any);
    render(<Stage projectId={PID} />);
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("false");
  });
  it("select mode + Alt held → stage draggable (temporary pan)", () => {
    useUiStore.setState({ canvasMode: "select" } as any);
    render(<Stage projectId={PID} />);
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("false");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    });
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    });
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("false");
  });
});

// Two on-board 1-row menus: m1 spans (0,0)→(352,266), m2 at (1000,1000).
function menu(id: string): Menu {
  return { id: id as MenuId, projectId: PID, title: [], rows: 1 } as unknown as Menu;
}
function projectWithMenus(): Project {
  return {
    ...project(),
    documents: {
      menu: [menu("m1"), menu("m2")],
    },
    canvasLayout: { m1: { x: 0, y: 0 }, m2: { x: 1000, y: 1000 } },
  } as Project;
}

// Konva mouse event with a target that IS the stage (empty-space drag).
function stageEvent(shiftKey = false, button = 0) {
  const stage = {
    getStage() {
      return stage;
    },
  };
  return {
    target: stage,
    evt: { shiftKey, button },
  } as unknown as Konva.KonvaEventObject<MouseEvent>;
}

describe("useMarqueeSelection — selection logic", () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  // Mutable pointer so down/move can report different positions.
  function renderMarquee(pk: Project, pointer: { x: number; y: number }) {
    const stageRef = {
      current: { getPointerPosition: () => pointer } as unknown as Konva.Stage,
    } as React.RefObject<Konva.Stage | null>;
    const hook = renderHook(() =>
      useMarqueeSelection({
        stageRef,
        viewport: { x: 0, y: 0, scale: 1 },
        project: pk,
        layout: pk.canvasLayout,
        active: true,
      }),
    );
    return { hook, pointer };
  }

  it("selects the menus whose box intersects the marquee", () => {
    const pk = projectWithMenus();
    const ptr = { x: 10, y: 10 };
    const { hook } = renderMarquee(pk, ptr);
    // down at (10,10)
    act(() => hook.result.current.onMouseDown(stageEvent()));
    // drag to (110,110): marquee (10,10)→(110,110) covers m1 only, not m2.
    ptr.x = 110;
    ptr.y = 110;
    act(() => hook.result.current.onMouseMove());
    act(() => hook.result.current.onMouseUp(stageEvent()));
    expect([...useSelectionStore.getState().ids]).toEqual(["m1"]);
  });

  it("shouldConsumeClick returns true once after a drag then false", () => {
    const pk = projectWithMenus();
    const ptr = { x: 10, y: 10 };
    const { hook } = renderMarquee(pk, ptr);
    act(() => hook.result.current.onMouseDown(stageEvent()));
    ptr.x = 110;
    ptr.y = 110;
    act(() => hook.result.current.onMouseMove());
    act(() => hook.result.current.onMouseUp(stageEvent()));
    expect(hook.result.current.shouldConsumeClick()).toBe(true);
    expect(hook.result.current.shouldConsumeClick()).toBe(false);
  });

  it("shift adds to the existing selection", () => {
    const pk = projectWithMenus();
    useSelectionStore.getState().add("m2");
    const ptr = { x: 10, y: 10 };
    const { hook } = renderMarquee(pk, ptr);
    act(() => hook.result.current.onMouseDown(stageEvent(true)));
    ptr.x = 110;
    ptr.y = 110;
    act(() => hook.result.current.onMouseMove());
    act(() => hook.result.current.onMouseUp(stageEvent(true)));
    expect([...useSelectionStore.getState().ids].sort()).toEqual(["m1", "m2"]);
  });

  it("middle button does not start a marquee (reserved for pan)", () => {
    const pk = projectWithMenus();
    const ptr = { x: 10, y: 10 };
    const { hook } = renderMarquee(pk, ptr);
    act(() => hook.result.current.onMouseDown(stageEvent(false, 1)));
    expect(hook.result.current.rect).toBeNull();
    ptr.x = 110;
    ptr.y = 110;
    act(() => hook.result.current.onMouseMove());
    expect(hook.result.current.rect).toBeNull();
  });
});
