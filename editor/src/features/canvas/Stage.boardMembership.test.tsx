import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { Stage } from "./Stage";

vi.mock("react-konva", () => ({
  Stage: (p: any) => <div data-testid="konva-stage">{p.children}</div>,
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => <div data-testid="konva-group" data-name={p.name}>{p.children}</div>,
  Rect: () => <div />, Image: () => <div />, Text: () => <div />, Line: () => <div />,
  Transformer: () => <div />, Arrow: () => <div />, Circle: () => <div />,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));
vi.mock("./title/composer/TitleRender", () => ({ TitleRender: () => <div /> }));
vi.mock("./Edges", () => ({ Edges: () => <div data-testid="edges" /> }));

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any,
            { id: "m2", projectId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", dialogs: [], canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Project;
}

describe("Stage — board membership", () => {
  beforeEach(() => {
    useAccountStore.setState({ account: { id: "a" as any, projects: [project()], projectOrder: [PID] } } as any);
  });
  it("ne rend QUE les éléments présents dans canvasLayout", () => {
    render(<Stage projectId={PID} />);
    const names = screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));
    expect(names).toContain("menu:m1");
    expect(names).not.toContain("menu:m2");
  });
});
