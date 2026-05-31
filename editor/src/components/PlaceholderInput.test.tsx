import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceholderInput } from "./PlaceholderInput";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";

const entries: PlaceholderEntry[] = [
  { path: "player", type: "player", sample: "Steve", origin: "context" },
  { path: "quest.name", type: "string", sample: "Q1", origin: "iteration" },
];

describe("PlaceholderInput", () => {
  it("opens the popup when the user types {", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // "player" appears in both the .name and .type spans of the first row —
    // use getAllByText and assert at least one match.
    expect(screen.getAllByText("player").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("quest.name")).toBeInTheDocument();
  });

  it("filters entries by query substring", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{qu" } });
    expect(screen.queryByText("player")).not.toBeInTheDocument();
    expect(screen.getByText("quest.name")).toBeInTheDocument();
  });

  it("renders type + sample alongside the path", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    fireEvent.input(screen.getByRole("combobox"), { target: { value: "{" } });
    // "player" appears in .name and .type; Steve appears only in .sample
    expect(screen.getAllByText("player").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Steve")).toBeInTheDocument();
  });

  it("Tab inserts the highlighted entry and closes the popup", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={(v) => calls.push(v)} entries={entries} />);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(calls).toContain("{player}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ArrowDown moves the highlight, Enter inserts the second entry", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={(v) => calls.push(v)} entries={entries} />);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toContain("{quest.name}");
  });

  it("Esc closes the popup without insertion (the { stays)", () => {
    const calls: string[] = [];
    render(<PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(calls.at(-1)).toBe("{");
  });

  it("typing } closes the popup without auto-insertion", () => {
    const { rerender } = render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={() => {}} entries={entries} />);
    fireEvent.input(input, { target: { value: "{}" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("typing a space closes the popup; the `{ ` stays as typed", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={(v) => calls.push(v)} entries={entries} />);
    fireEvent.input(input, { target: { value: "{ " } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // onChange was called with "{ " — the space stays as typed, no insertion
    expect(calls.at(-1)).toBe("{ ");
  });

  it("backspacing past the original { closes the popup", () => {
    const { rerender } = render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={() => {}} entries={entries} />);
    fireEvent.input(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows the empty-match row when query filters all out", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{xyz" } });
    expect(screen.getByText(/xyz/)).toBeInTheDocument();
  });

  it("shows the no-context message when there are zero entries to begin with", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={[]} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    expect(screen.getByText(/disponible|available/i)).toBeInTheDocument();
  });

  it("renders the hint below the input when entries is non-empty and the popup is closed", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    // Matches both French "insérer" and English "insert"
    expect(screen.getByText(/ins[eé]rer|insert/i)).toBeInTheDocument();
  });

  it("hides the hint while the popup is open", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    fireEvent.input(screen.getByRole("combobox"), { target: { value: "{" } });
    // The popup is open; the hint should disappear so we don't show both at once.
    expect(screen.queryAllByText(/ins[eé]rer|insert/i)).toHaveLength(0);
  });

  it("does not render the hint when entries is empty", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={[]} />);
    expect(screen.queryByText(/ins[eé]rer|insert/i)).not.toBeInTheDocument();
  });

  it("clicking outside closes the popup", () => {
    render(
      <>
        <PlaceholderInput value="" onChange={() => {}} entries={entries} />
        <div data-testid="outside">outside</div>
      </>,
    );
    fireEvent.input(screen.getByRole("combobox"), { target: { value: "{" } });
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
