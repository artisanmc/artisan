import type { Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GhostChips } from "./GhostChips";

vi.mock("react-konva", () => ({
  Group: (p: any) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: test stub of a Konva node (canvas, no keyboard); the div only relays fireEvent.click to the handler
    <div
      data-testid={p.name ? "konva-group" : undefined}
      data-name={p.name}
      onClick={(e) => p.onClick?.({ ...e, cancelBubble: false })}
    >
      {p.children}
    </div>
  ),
  Rect: () => <div />,
}));

// The vanilla font draws into a canvas from atlas images: stub it with its
// plain text, the MiniMessage source kept on the node for the assertions.
vi.mock("./title/VanillaMcText", async () => {
  const { plainTextFromMiniMessage } = await import("@/lib/miniMessage");
  return {
    VanillaMcText: (p: any) => (
      <span data-testid="konva-text" data-source={p.source}>
        {plainTextFromMiniMessage(p.source)}
      </span>
    ),
    vanillaTextWidth: (t: string) => t.length * 6,
  };
});

// The edges are controlled directly, reconfigurable per test through mockEdges.
let mockEdges: { id: string; source: string; target: string; triggers: unknown[] }[] = [
  { id: "menu/m1->menu/shop", source: "menu/m1", target: "menu/shop", triggers: [] },
];
vi.mock("@/features/project/useProjectDocuments", () => ({
  documentLabel: (_p: unknown, id: string) =>
    id === "menu/shop" ? "<b><gradient:#A5F869:#0CAB27>Shop</gradient></b>" : id,
}));

vi.mock("./deriveEdges", () => ({
  deriveEdges: () => mockEdges,
}));

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [
        { id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any,
        { id: "shop", projectId: PID, title: [], rows: 3, layers: [] } as any,
        { id: "bank", projectId: PID, title: [], rows: 3, layers: [] } as any,
      ],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: { "menu/m1": { x: 0, y: 0 } } as any,
  } as Project;
}

describe("GhostChips", () => {
  beforeEach(() => {
    mockEdges = [
      { id: "menu/m1->menu/shop", source: "menu/m1", target: "menu/shop", triggers: [] },
    ];
    useProjectsStore.setState({
      openProjects: { projects: [project()], projectOrder: [PID] },
    } as any);
  });

  it("renders a chip for an off-board target from a node on the board", () => {
    const layout = { "menu/m1": { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} />);
    expect(screen.getByTestId("konva-group").getAttribute("data-name")).toBe(
      "ghostchip:menu/m1->menu/shop",
    );
  });

  it("on the board, the pill flags a missing target without writing anything", () => {
    const before = useProjectsStore.getState().openProjects;
    const layout = { "menu/m1": { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} />);
    fireEvent.click(screen.getByTestId("konva-group"));
    expect(useProjectsStore.getState().openProjects).toBe(before);
  });

  /**
   * In focus view there is no board to populate: the chip navigates to the
   * target Document, whether it is on the board or not.
   */
  it("in focus, the click opens the target instead of placing it on the board", () => {
    const onOpen = vi.fn();
    const layout = { "menu/m1": { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("konva-group"));
    expect(onOpen).toHaveBeenCalledWith("menu/shop");
  });

  it("renders two distinct chips for two off-board targets of the same source", () => {
    mockEdges = [
      { id: "menu/m1->menu/shop", source: "menu/m1", target: "menu/shop", triggers: [] },
      { id: "menu/m1->menu/bank", source: "menu/m1", target: "menu/bank", triggers: [] },
    ];
    const layout = { "menu/m1": { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} />);
    const names = screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));
    expect(names).toContain("ghostchip:menu/m1->menu/shop");
    expect(names).toContain("ghostchip:menu/m1->menu/bank");
    expect(new Set(names).size).toBe(2);
  });

  it("renders the target label as MiniMessage, not raw tags", () => {
    render(<GhostChips project={project()} layout={{ "menu/m1": { x: 0, y: 0 } }} />);
    const text = screen
      .getAllByTestId("konva-text")
      .map((t) => t.textContent)
      .join("");
    expect(text).toBe("→ Shop");
  });

  it("draws the label with the vanilla MC font, keeping its MiniMessage styling", () => {
    render(<GhostChips project={project()} layout={{ "menu/m1": { x: 0, y: 0 } }} />);
    const [node] = screen.getAllByTestId("konva-text");
    expect(node?.getAttribute("data-source")).toContain(
      "<b><gradient:#A5F869:#0CAB27>Shop</gradient></b>",
    );
  });
});
