import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";

import { menusOf } from "@/domain/documents";
import { MenuGroup } from "./MenuGroup";

// Stub react-konva so MenuGroup renders to plain DOM. We expose `name`
// (a Konva-only attribute Konva itself uses to identify nodes) as
// data-name so tests can pick the right Group out of the tree, and forward
// onClick / onTap / onDblClick. Other shapes (Rect, Image, Text) render to no-op divs.
type ClickHandler = (e: { cancelBubble: boolean; evt: MouseEvent }) => void;

vi.mock("react-konva", () => ({
  Group: (props: {
    children?: React.ReactNode;
    name?: string;
    onClick?: ClickHandler;
    onTap?: ClickHandler;
    onDblClick?: ClickHandler;
    onDblTap?: ClickHandler;
    x?: number;
    y?: number;
  }) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: test stub of a Konva node (canvas, no keyboard); the div only relays fireEvent.click to the handler
    <div
      data-testid="konva-group"
      data-name={props.name}
      data-x={props.x}
      data-y={props.y}
      onClick={(e) => {
        const evt = { cancelBubble: false, evt: e.nativeEvent as MouseEvent };
        props.onClick?.(evt);
      }}
      onDoubleClick={(e) => {
        const evt = { cancelBubble: false, evt: e.nativeEvent as MouseEvent };
        props.onDblClick?.(evt);
      }}
    >
      {props.children}
    </div>
  ),
  Rect: () => <div data-testid="konva-rect" />,
  Image: () => <div data-testid="konva-image" />,
  Text: () => <div data-testid="konva-text" />,
}));

vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));

// TitleRender pulls in many side-effecty children — render it as an empty
// shell so MenuGroup's own click path stays the focus.
vi.mock("./title/composer/TitleRender", () => ({
  TitleRender: () => <div data-testid="title-render-stub" />,
}));

const PACK_ID = "p1" as ProjectId;
const MENU_ID = "m1" as MenuId;

function makeProject(): Project {
  return {
    id: PACK_ID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [
        {
          id: MENU_ID,
          projectId: PACK_ID,
          title: [],
          rows: 3,
          layers: [],
        } as Menu,
      ],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  };
}

beforeEach(() => {
  useProjectsStore.setState({
    openProjects: {
      projects: [makeProject()],
      projectOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({
    selectedMenuId: null,
    lastSelectedMenuId: null,
    armedMaterial: null,
    activeLang: "en",
  } as any);
  useSelectionStore.setState({ ids: new Set(), focusedSlot: null } as any);
});

describe("MenuGroup — onClick updates uiStore.selectedMenuId", () => {
  it("clicking the menu's outer Group sets uiStore.selectedMenuId to this menu's id", () => {
    const menu = menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!;
    render(
      <MenuGroup
        projectId={PACK_ID}
        menu={menu}
        position={{ x: 0, y: 0 }}
        layout={{ [MENU_ID]: { x: 0, y: 0 } }}
      />,
    );
    // Pre-condition: nothing selected yet.
    expect(useUiStore.getState().selectedMenuId).toBeNull();

    // Find the outer Group for this menu (Konva would receive the click
    // bubbling up through nested Groups; the stubbed react-konva mirrors
    // the `name` prop as data-name so we can pick it directly).
    const outer = screen
      .getAllByTestId("konva-group")
      .find((g) => g.getAttribute("data-name") === `menu:${MENU_ID}`);
    expect(outer).toBeDefined();
    fireEvent.click(outer!);

    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
    // setSelectedMenuId also bumps lastSelectedMenuId so the LayersPanel
    // stays sticky across canvas deselects.
    expect(useUiStore.getState().lastSelectedMenuId).toBe(MENU_ID);
  });

  it("clicking the menu also sets it in the legacy selectionStore (element-selection store)", () => {
    const menu = menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!;
    render(
      <MenuGroup
        projectId={PACK_ID}
        menu={menu}
        position={{ x: 0, y: 0 }}
        layout={{ [MENU_ID]: { x: 0, y: 0 } }}
      />,
    );
    const outer = screen
      .getAllByTestId("konva-group")
      .find((g) => g.getAttribute("data-name") === `menu:${MENU_ID}`)!;
    fireEvent.click(outer);
    // Selection store still receives the menu id so drag-out / drag-to-move
    // continues working.
    expect(useSelectionStore.getState().ids.has(`menu/${MENU_ID}`)).toBe(true);
  });

  it("solo: clicking the menu re-selects it after an element was selected", () => {
    const menu = menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!;
    useSelectionStore.setState({ ids: new Set(["el1"]), focusedSlot: 3 } as any);
    render(
      <MenuGroup projectId={PACK_ID} menu={menu} position={{ x: 0, y: 0 }} layout={{}} solo />,
    );
    const outer = screen
      .getAllByTestId("konva-group")
      .find((g) => g.getAttribute("data-name") === `menu:${MENU_ID}`)!;
    fireEvent.click(outer);

    expect(useSelectionStore.getState().ids.has(`menu/${MENU_ID}`)).toBe(true);
    expect(useSelectionStore.getState().ids.has("el1")).toBe(false);
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
  });
});
