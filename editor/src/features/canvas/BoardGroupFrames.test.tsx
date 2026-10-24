import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";
import { BoardGroupFrames } from "./BoardGroupFrames";
import type { BoardGroup } from "./groupedBoard";

vi.mock("react-konva", () => ({
  Group: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Rect: ({ fill, opacity, listening }: { fill: string; opacity?: number; listening?: boolean }) => (
    <div data-testid="rect" data-fill={fill} data-opacity={opacity} data-listening={listening} />
  ),
  Text: ({ text }: { text: string }) => <span>{text}</span>,
}));

it("tints only the background at 15% and keeps the label readable without fold buttons", () => {
  const group = {
    key: "g",
    id: "g",
    projectId: "p",
    name: "Crafts",
    kind: "group",
    members: ["a", "b"],
    color: "#a855f7",
    x: 0,
    y: 0,
    width: 300,
    height: 400,
  } as BoardGroup;
  render(<BoardGroupFrames groups={[group]} />);
  expect(
    screen
      .getAllByTestId("rect")
      .some((rect) => rect.dataset.fill === "#a855f7" && rect.dataset.opacity === "0.15"),
  ).toBe(true);
  expect(screen.getByText("Crafts")).toBeVisible();
  expect(screen.queryByText("−")).not.toBeInTheDocument();
  expect(screen.queryByText("+")).not.toBeInTheDocument();
});
