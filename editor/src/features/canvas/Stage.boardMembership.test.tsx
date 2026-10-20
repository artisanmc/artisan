import type { Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Stage } from "./Stage";

vi.mock("react-konva", () => ({
  Stage: (p: any) => <div data-testid="konva-stage">{p.children}</div>,
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => (
    <div data-testid="konva-group" data-name={p.name}>
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
        { id: "m2", projectId: PID, title: [], rows: 3, layers: [] } as any,
      ],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Project;
}

describe("Stage — derived board", () => {
  beforeEach(() => {
    useProjectsStore.setState({
      openProjects: { projects: [project()], projectOrder: [PID] },
    } as any);
  });
  it("renders every Document of the project, even those never placed by hand", () => {
    render(<Stage projectId={PID} />);
    const names = screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));
    expect(names).toContain("menu:m1");
    expect(names).toContain("menu:m2");
  });
  it("shows only folder frames in project view even when the project is folded", () => {
    const filed = project();
    (filed.documents.menu![1] as any).folder = "crafts";
    useProjectsStore.setState({
      openProjects: {
        projects: [{ ...filed, canvasProjectCollapsed: true }],
        projectOrder: [PID],
      },
    } as any);
    render(<Stage projectId={PID} />);
    const names = screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));
    expect(names).not.toContain("board-group:@project/p1");
    expect(names).toContain("board-group:@group/p1/crafts");
    expect(names).toContain("menu:m1");
    expect(names).toContain("menu:m2");
  });
  it("keeps a folder's menus visible on the board and in document view", () => {
    const filed = project();
    for (const m of filed.documents.menu!) (m as any).folder = "crafts";
    useProjectsStore.setState({
      openProjects: {
        projects: [filed],
        projectOrder: [PID],
      },
    } as any);
    const { rerender } = render(<Stage projectId={PID} />);
    expect(
      screen.getAllByTestId("konva-group").some((g) => g.getAttribute("data-name") === "menu:m1"),
    ).toBe(true);
    rerender(<Stage projectId={PID} focus={"m1" as any} />);
    expect(
      screen.getAllByTestId("konva-group").some((g) => g.getAttribute("data-name") === "menu:m1"),
    ).toBe(true);
  });
});
