import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { McScreen } from "./McScreen";

describe("McScreen", () => {
  it("picks the game's GUI scale for the window", () => {
    render(<McScreen width={1920} height={1080} />);
    const el = screen.getByTestId("mc-screen");
    expect(el.dataset.guiScale).toBe("4");
    expect(el.dataset.guiSize).toBe("480x270");
  });

  it("caps a fixed scale at the largest the window allows", () => {
    render(<McScreen width={854} height={480} guiScale={5} />);
    expect(screen.getByTestId("mc-screen").dataset.guiScale).toBe("2");
  });

  it("keeps the last 10 chat lines closed, 20 open, with the input", () => {
    const chat = Array.from({ length: 25 }, (_, k) => `line ${k}`);
    const { rerender } = render(<McScreen width={854} height={480} chat={chat} />);
    expect(screen.getByTestId("mc-screen-chat").children).toHaveLength(10);
    expect(screen.queryByTestId("mc-screen-chat-input")).toBeNull();
    rerender(<McScreen width={854} height={480} chat={chat} chatInput="/menu" />);
    expect(screen.getByTestId("mc-screen-chat").children).toHaveLength(20);
    expect(screen.getByTestId("mc-screen-chat-input")).toBeInTheDocument();
  });

  it("wraps a long message at the chat's width", () => {
    render(<McScreen width={854} height={480} chat={["word ".repeat(80).trim()]} />);
    expect(screen.getByTestId("mc-screen-chat").children.length).toBeGreaterThan(1);
  });

  it("hands layers and an open screen the layout in window pixels", () => {
    render(
      <McScreen
        width={1920}
        height={1080}
        screen={({ layout, scale }) => <span data-testid="menu">{`${layout.width}/${scale}`}</span>}
      >
        {({ layout }) => <span data-testid="layer">{layout.actionBarTop}</span>}
      </McScreen>,
    );
    expect(screen.getByTestId("menu")).toHaveTextContent("480/4");
    expect(screen.getByTestId("layer")).toHaveTextContent("198");
    expect(screen.getByTestId("mc-screen-open")).toBeInTheDocument();
  });

  it("draws boss bars only down to a third of the screen", () => {
    const bars = Array.from({ length: 8 }, (_, k) => ({ name: `bar ${k}`, progress: 0.5 }));
    const { container } = render(<McScreen width={854} height={480} bossBars={bars} />);
    expect(container.querySelectorAll('[data-sprite$="_background"]')).toHaveLength(4);
  });
});
