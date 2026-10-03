import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Stage } from "./Stage";

type P = { children?: ReactNode; name?: string; opacity?: number; listening?: boolean };
vi.mock("react-konva", () => ({
  Stage: (p: P) => <div data-testid="konva-stage">{p.children}</div>,
  Layer: (p: P) => (
    <div
      data-testid="konva-layer"
      data-name={p.name}
      data-opacity={p.opacity ?? 1}
      data-listening={String(p.listening ?? true)}
    >
      {p.children}
    </div>
  ),
  Group: (p: P) => (
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
    menus: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] }],
    commands: [{ id: "c1", projectId: PID, name: "c1", arguments: [], steps: [] }],
    dialogs: [{ id: "d1", projectId: PID, title: { key: "t" }, buttons: [], body: [], inputs: [] }],
    assets: [],
    dataSources: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as unknown as Project;
}

const layer = (name: string) =>
  screen.getAllByTestId("konva-layer").find((l) => l.getAttribute("data-name") === name)!;
const groupNames = () =>
  screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "a" as never, projects: [project()], projectOrder: [PID] },
  } as never);
  useUiStore.setState({ canvasHiddenKinds: [], canvasViewports: {} });
});

describe("Stage — filtres par type", () => {
  it("atténue un type écarté sans le retirer de la planche, et le rend inerte", () => {
    useUiStore.setState({ canvasHiddenKinds: ["command"] });
    render(<Stage projectId={PID} />);
    expect(Number(layer("commands").getAttribute("data-opacity"))).toBeLessThan(1);
    expect(layer("commands").getAttribute("data-listening")).toBe("false");
    expect(layer("menus").getAttribute("data-opacity")).toBe("1");
    expect(layer("dialogs").getAttribute("data-opacity")).toBe("1");
    expect(groupNames()).toContain("command:c1");
  });
});

describe("Stage — zoom sémantique", () => {
  it("rend les menus en cartes légères quand la planche est vue de loin", () => {
    useUiStore.setState({ canvasViewports: { [PID]: { x: 0, y: 0, scale: 0.2 } } });
    render(<Stage projectId={PID} />);
    expect(groupNames()).toContain("menu-card:m1");
    expect(groupNames()).not.toContain("menu:m1");
  });

  it("rend l'inventaire complet de près", () => {
    useUiStore.setState({ canvasViewports: { [PID]: { x: 0, y: 0, scale: 1 } } });
    render(<Stage projectId={PID} />);
    expect(groupNames()).toContain("menu:m1");
    expect(groupNames()).not.toContain("menu-card:m1");
  });

  it("ne réduit jamais le menu de la vue focus", () => {
    useUiStore.setState({ documentViewport: { x: 0, y: 0, scale: 0.2 } });
    render(<Stage projectId={PID} focus={"m1" as never} />);
    expect(groupNames()).toContain("menu:m1");
  });
});
