import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
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
    useAccountStore.setState({
      account: { id: "a" as any, projects: [project()], projectOrder: [PID] },
    } as any);
  });
  it("renders every Document of the project, even those never placed by hand", () => {
    render(<Stage projectId={PID} />);
    const names = screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));
    expect(names).toContain("menu:m1");
    expect(names).toContain("menu:m2");
  });
  it("shows only manual frames in project view even when the project is folded", () => {
    useAccountStore.setState({
      account: {
        id: "a" as any,
        projects: [
          {
            ...project(),
            canvasProjectCollapsed: true,
            canvasGroups: [{ id: "crafts", name: "Crafts", menuIds: ["m2"] }],
          },
        ],
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
  it("keeps legacy folded group menus visible on the board and in document view", () => {
    useAccountStore.setState({
      account: {
        id: "a" as any,
        projects: [
          {
            ...project(),
            canvasGroups: [
              { id: "crafts", name: "Crafts", menuIds: ["m1", "m2"], collapsed: true },
            ],
          },
        ],
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
