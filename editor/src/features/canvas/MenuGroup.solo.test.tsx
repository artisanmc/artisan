import type { Menu, MenuId, ProjectId } from "@/domain/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OPEN_ELEMENT_EVENT } from "./canvasEvents";

vi.mock("react-konva", () => ({
  Group: (props: any) => (
    <div
      data-testid="konva-group"
      data-name={props.name}
      data-x={String(props.x)}
      data-draggable={String(props.draggable)}
      onDoubleClick={(e: any) => props.onDblClick?.({ cancelBubble: false, evt: e.nativeEvent })}
    >
      {props.children}
    </div>
  ),
  Rect: () => <div />,
  Image: () => <div />,
  Text: () => <div />,
  Line: () => <div />,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));
vi.mock("./title/composer/TitleRender", () => ({ TitleRender: () => <div /> }));

import { MenuGroup } from "./MenuGroup";

describe("MenuGroup solo", () => {
  it("does not set a draggable Group and renders at the origin", () => {
    const menu = {
      id: "m1" as MenuId,
      projectId: "p1" as ProjectId,
      title: [],
      rows: 3,
      layers: [],
    } as Menu;
    render(
      <MenuGroup
        projectId={"p1" as ProjectId}
        menu={menu}
        position={{ x: 99, y: 99 }}
        layout={{}}
        solo
      />,
    );
    const outer = screen
      .getAllByTestId("konva-group")
      .find((g) => g.getAttribute("data-name") === "menu:m1")!;
    expect(outer.getAttribute("data-x")).toBe("0");
    expect(outer.getAttribute("data-draggable")).toBe("false");
  });

  it("double-click (board mode) emits ifz:open_element with the menu id", () => {
    const spy = vi.fn();
    window.addEventListener(OPEN_ELEMENT_EVENT, spy as any);
    const menu = {
      id: "m1" as MenuId,
      projectId: "p1" as ProjectId,
      title: [],
      rows: 3,
      layers: [],
    } as Menu;
    render(
      <MenuGroup
        projectId={"p1" as ProjectId}
        menu={menu}
        position={{ x: 0, y: 0 }}
        layout={{ m1: { x: 0, y: 0 } }}
      />,
    );
    const g = screen
      .getAllByTestId("konva-group")
      .find((x) => x.getAttribute("data-name") === "menu:m1")!;
    fireEvent.doubleClick(g);
    expect(spy).toHaveBeenCalled();
    const ev = spy.mock.calls[0]![0] as CustomEvent;
    expect(ev.detail.id).toBe("menu/m1");
    window.removeEventListener(OPEN_ELEMENT_EVENT, spy as any);
  });

  it("double-click in solo mode does not emit ifz:open_element", () => {
    const spy = vi.fn();
    window.addEventListener(OPEN_ELEMENT_EVENT, spy as any);
    const menu = {
      id: "m1" as MenuId,
      projectId: "p1" as ProjectId,
      title: [],
      rows: 3,
      layers: [],
    } as Menu;
    render(
      <MenuGroup
        projectId={"p1" as ProjectId}
        menu={menu}
        position={{ x: 0, y: 0 }}
        layout={{}}
        solo
      />,
    );
    const g = screen
      .getAllByTestId("konva-group")
      .find((x) => x.getAttribute("data-name") === "menu:m1")!;
    fireEvent.doubleClick(g);
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener(OPEN_ELEMENT_EVENT, spy as any);
  });
});
