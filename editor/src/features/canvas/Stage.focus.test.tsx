import type { ElementId, Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Stage } from "./Stage";
import { INVENTORY_TYPES } from "./inventoryTypes";
import { TEX_SCALE } from "./menuLayout";
import { tryStageDrop } from "./stageDropTarget";

vi.mock("react-konva", () => ({
  Stage: (p: any) => <div data-testid="konva-stage">{p.children}</div>,
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => (
    <div data-testid="konva-group" data-name={p.name} data-draggable={String(!!p.draggable)}>
      {p.children}
    </div>
  ),
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
vi.mock("./Edges", () => ({ Edges: () => <div data-testid="edges" /> }));

const PID = "p1" as ProjectId;

/** `m1` is on the board, `m2` is not — that is the whole point of focus. */
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      { id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any,
      { id: "m2", projectId: PID, title: [], rows: 3, layers: [] } as any,
    ],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Project;
}

function groupNames(): (string | null)[] {
  return screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));
}

describe("Stage — mode focus", () => {
  beforeEach(() => {
    useAccountStore.setState({
      account: { id: "a" as any, projects: [project()], projectOrder: [PID] },
    } as any);
  });

  /**
   * Focus builds its own layout table: board membership has no effect on it.
   * That is what guarantees a Document never placed on the board stays fully
   * editable.
   */
  it("renders the targeted document even when absent from canvasLayout", () => {
    render(<Stage projectId={PID} focus={"m2" as ElementId} />);
    expect(groupNames()).toContain("menu:m2");
  });

  it("renders no other document, even one present on the board", () => {
    render(<Stage projectId={PID} focus={"m2" as ElementId} />);
    expect(groupNames()).not.toContain("menu:m1");
  });

  /** No board position in focus: moving it would have nothing to write. */
  it("the focused document cannot be dragged", () => {
    render(<Stage projectId={PID} focus={"m2" as ElementId} />);
    const g = screen
      .getAllByTestId("konva-group")
      .find((x) => x.getAttribute("data-name") === "menu:m2");
    expect(g?.getAttribute("data-draggable")).toBe("false");
  });

  /**
   * The gap the merge fills: the document view registered a canvas of its own,
   * with no drop target — dragging an item from the Library silently did
   * nothing.
   */
  it("accepts dropping an item from the Library", () => {
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    render(<Stage projectId={PID} focus={"m2" as ElementId} />);

    const g = INVENTORY_TYPES.chest;
    const placed = tryStageDrop(
      g.firstSlotX * TEX_SCALE + 4,
      g.firstSlotY * TEX_SCALE + 4,
      "DIAMOND",
    );

    expect(placed).toBe(true);
    const menu = useAccountStore.getState().account.projects[0]!.menus.find((m) => m.id === "m2")!;
    expect(menu.layers.flatMap((l) => l.elements)).not.toHaveLength(0);
  });
});
