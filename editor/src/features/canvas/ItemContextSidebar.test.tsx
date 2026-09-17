import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ItemContextSidebar } from "./ItemContextSidebar";

it("shows a temporary check on the copied button for 1.5 seconds", async () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(
      <ItemContextSidebar
        entries={[{ path: "player", type: "player", origin: "context", sample: null }]}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copier {player}" })));
    const button = screen.getByRole("button", { name: "Copié ! {player}" });
    expect(button.querySelector("svg.lucide-check")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1500));
    expect(
      screen.getByRole("button", { name: "Copier {player}" }).querySelector("svg.lucide-copy"),
    ).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("filters the supplied context and removes entries when context changes", () => {
  const { rerender } = render(
    <ItemContextSidebar
      entries={[
        { path: "quest.name", type: "string", origin: "iteration", sample: "Quest" },
        { path: "player", type: "player", origin: "context", sample: null },
      ]}
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "QUEST" } });
  expect(screen.getByText("{quest.name}")).toBeInTheDocument();
  expect(screen.queryByText("{player}")).not.toBeInTheDocument();
  rerender(<ItemContextSidebar entries={[]} />);
  expect(screen.queryByText("{quest.name}")).not.toBeInTheDocument();
  expect(screen.getByText("Aucun placeholder correspondant.")).toBeInTheDocument();
});

it("reports a clipboard failure without claiming the placeholder was copied", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
  });
  render(
    <ItemContextSidebar
      entries={[{ path: "player", type: "player", origin: "context", sample: null }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copier {player}" }));
  expect(await screen.findByText(/Copie impossible/)).toBeInTheDocument();
  expect(screen.getByRole("status")).not.toHaveTextContent("Copié");
});
