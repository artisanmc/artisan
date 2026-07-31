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

// On contrôle les edges directement. Reconfigurable par test via mockEdges.
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

  it("rend un chip pour une cible hors-planche depuis un nœud sur la planche", () => {
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} projectId={PID} />);
    expect(screen.getByTestId("konva-group").getAttribute("data-name")).toBe(
      "ghostchip:m1->shop",
    );
  });

  it("le clic sur le chip ajoute la cible à la planche", () => {
    const spy = vi.spyOn(useAccountStore.getState(), "addToBoard");
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} projectId={PID} />);
    fireEvent.click(screen.getByTestId("konva-group"));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PID, nodeId: "shop" }),
    );
  });

  it("rend deux chips distincts pour deux cibles hors-planche d'une même source", () => {
    mockEdges = [
      { id: "m1->shop", source: "m1", target: "shop", triggers: [] },
      { id: "m1->bank", source: "m1", target: "bank", triggers: [] },
    ];
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips project={project()} layout={layout} projectId={PID} />);
    const names = screen
      .getAllByTestId("konva-group")
      .map((g) => g.getAttribute("data-name"));
    expect(names).toContain("ghostchip:m1->shop");
    expect(names).toContain("ghostchip:m1->bank");
    expect(new Set(names).size).toBe(2);
  });
});
