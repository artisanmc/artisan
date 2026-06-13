import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Menu, MenuId, PackId } from "@/domain/types";

vi.mock("react-konva", () => ({
  Group: (props: any) => (
    <div
      data-testid="konva-group"
      data-name={props.name}
      data-x={String(props.x)}
      data-draggable={String(props.draggable)}
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
});
