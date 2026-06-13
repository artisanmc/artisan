import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Menu, MenuId, PackId } from "@/domain/types";

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
  it("ne pose pas de Group draggable et se rend à l'origine", () => {
    const menu = { id: "m1" as MenuId, packId: "p1" as PackId, title: [], rows: 3, layers: [] } as Menu;
    render(<MenuGroup packId={"p1" as PackId} menu={menu} position={{ x: 99, y: 99 }} layout={{}} solo />);
    const outer = screen.getAllByTestId("konva-group").find((g) => g.getAttribute("data-name") === "menu:m1")!;
    expect(outer.getAttribute("data-x")).toBe("0");
    expect(outer.getAttribute("data-draggable")).toBe("false");
  });

  it("double-clic (mode board) émet ifz:open_element avec l'id du menu", () => {
    const spy = vi.fn();
    window.addEventListener("ifz:open_element", spy as any);
    const menu = { id: "m1" as MenuId, packId: "p1" as PackId, title: [], rows: 3, layers: [] } as Menu;
    render(<MenuGroup packId={"p1" as PackId} menu={menu} position={{ x: 0, y: 0 }} layout={{ m1: { x: 0, y: 0 } }} />);
    const g = screen.getAllByTestId("konva-group").find((x) => x.getAttribute("data-name") === "menu:m1")!;
    fireEvent.doubleClick(g);
    expect(spy).toHaveBeenCalled();
    const ev = spy.mock.calls[0][0] as CustomEvent;
    expect(ev.detail.id).toBe("m1");
    window.removeEventListener("ifz:open_element", spy as any);
  });

  it("double-clic en mode solo n'émet pas ifz:open_element", () => {
    const spy = vi.fn();
    window.addEventListener("ifz:open_element", spy as any);
    const menu = { id: "m1" as MenuId, packId: "p1" as PackId, title: [], rows: 3, layers: [] } as Menu;
    render(<MenuGroup packId={"p1" as PackId} menu={menu} position={{ x: 0, y: 0 }} layout={{}} solo />);
    const g = screen.getAllByTestId("konva-group").find((x) => x.getAttribute("data-name") === "menu:m1")!;
    fireEvent.doubleClick(g);
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener("ifz:open_element", spy as any);
  });
});
