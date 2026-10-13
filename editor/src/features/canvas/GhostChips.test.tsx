import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { GhostChips } from "./GhostChips";

vi.mock("react-konva", () => ({
  Group: (p: any) => (
    <div data-testid="konva-group" data-name={p.name} onClick={(e) => p.onClick?.({ ...e, cancelBubble: false })}>
      {p.children}
    </div>
  ),
  Rect: () => <div />,
  Text: () => <div />,
}));

// The edges are controlled directly, reconfigurable per test through mockEdges.
let mockEdges: { id: string; source: string; target: string; triggers: unknown[] }[] = [
  { id: "m1->shop", source: "m1", target: "shop", triggers: [] },
];
vi.mock("./deriveEdges", () => ({
  deriveEdges: () => mockEdges,
}));

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [
      { id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any,
      { id: "shop", projectId: PID, title: [], rows: 3, layers: [] } as any,
      { id: "bank", projectId: PID, title: [], rows: 3, layers: [] } as any,
    ],
    commands: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", dialogs: [], canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Project;
}

describe("GhostChips", () => {
  beforeEach(() => {
    mockEdges = [{ id: "m1->shop", source: "m1", target: "shop", triggers: [] }];
    useAccountStore.setState({
      account: { id: "a" as any, projects: [project()], projectOrder: [PID] },
    } as any);
  });

  it("renders a chip for an off-board target from a node on the board", () => {
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} />);
    expect(screen.getByTestId("konva-group").getAttribute("data-name")).toBe(
      "ghostchip:m1->shop",
    );
  });

  it("on the board, the pill flags a missing target without writing anything", () => {
    const before = useAccountStore.getState().account;
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} />);
    fireEvent.click(screen.getByTestId("konva-group"));
    expect(useAccountStore.getState().account).toBe(before);
  });

  /**
   * In focus view there is no board to populate: the chip navigates to the
   * target Document, whether it is on the board or not.
   */
  it("in focus, the click opens the target instead of placing it on the board", () => {
    const onOpen = vi.fn();
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("konva-group"));
    expect(onOpen).toHaveBeenCalledWith("shop");
  });

  it("renders two distinct chips for two off-board targets of the same source", () => {
    mockEdges = [
      { id: "m1->shop", source: "m1", target: "shop", triggers: [] },
      { id: "m1->bank", source: "m1", target: "bank", triggers: [] },
    ];
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} />);
    const names = screen
      .getAllByTestId("konva-group")
      .map((g) => g.getAttribute("data-name"));
    expect(names).toContain("ghostchip:m1->shop");
    expect(names).toContain("ghostchip:m1->bank");
    expect(new Set(names).size).toBe(2);
  });
});
