import "@/i18n";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceholderInput } from "./PlaceholderInput";

const entries: PlaceholderEntry[] = [
  { path: "player", type: "player", sample: "Steve", origin: "context" },
  { path: "quest.name", type: "string", sample: "Q1", origin: "iteration" },
];

describe("PlaceholderInput", () => {
  it("does not suggest anything or consume Tab for % when no expansion declares placeholders", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "%" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
  });

  it("opens pending % suggestions when the catalog arrives, then hides them offline", () => {
    const { rerender } = render(<PlaceholderInput value="" onChange={() => {}} entries={[]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "%" } });
    rerender(
      <PlaceholderInput
        value="%"
        onChange={() => {}}
        entries={[]}
        papiPlaceholders={[{ placeholder: "%player_name%", expansion: "player" }]}
      />,
    );
    expect(screen.getByText("%player_name%")).toBeInTheDocument();
    rerender(<PlaceholderInput value="%" onChange={() => {}} entries={[]} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps manual completed tokens closed and inserts at the textarea caret without dropping the suffix", () => {
    const calls: string[] = [];
    const papiPlaceholders = [{ placeholder: "%player_name%", expansion: "player" }];
    const { rerender } = render(
      <PlaceholderInput
        multiline
        value=""
        onChange={(v) => calls.push(v)}
        entries={entries}
        papiPlaceholders={papiPlaceholders}
      />,
    );
    const input = screen.getByRole("combobox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "%player_name%" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(input, {
      target: { value: "%player_name%\n%pla suffix", selectionStart: 18, selectionEnd: 18 },
    });
    rerender(
      <PlaceholderInput
        multiline
        value={"%player_name%\n%pla suffix"}
        onChange={(v) => calls.push(v)}
        entries={entries}
        papiPlaceholders={papiPlaceholders}
      />,
    );
    input.setSelectionRange(18, 18);
    fireEvent.mouseDown(screen.getByRole("option", { name: /%player_name%/ }));
    expect(calls.at(-1)).toBe("%player_name%\n%player_name% suffix");
  });

  it("filters declared PAPI placeholders after % and inserts the full token with Tab", () => {
    const calls: string[] = [];
    const papiPlaceholders = [
      { placeholder: "%player_name%", expansion: "player" },
      { placeholder: "%vault_eco_balance%", expansion: "vault" },
    ];
    const { rerender } = render(
      <PlaceholderInput
        value=""
        onChange={(v) => calls.push(v)}
        entries={entries}
        papiPlaceholders={papiPlaceholders}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Hello %pla" } });
    rerender(
      <PlaceholderInput
        value="Hello %pla"
        onChange={(v) => calls.push(v)}
        entries={entries}
        papiPlaceholders={papiPlaceholders}
      />,
    );
    expect(screen.getByText("%player_name%")).toBeInTheDocument();
    expect(screen.queryByText("%vault_eco_balance%")).not.toBeInTheDocument();
    expect(screen.queryByText("quest.name")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(calls.at(-1)).toBe("Hello %player_name%");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens the popup when the user types {", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // "player" appears in both the .name and .type spans of the first row —
    // use getAllByText and assert at least one match.
    expect(screen.getAllByText("player").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("quest.name")).toBeInTheDocument();
  });

  it("filters entries by query substring", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{qu" } });
    expect(screen.queryByText("player")).not.toBeInTheDocument();
    expect(screen.getByText("quest.name")).toBeInTheDocument();
  });

  it("renders type + sample alongside the path", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "{" } });
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
    fireEvent.change(input, { target: { value: "{" } });
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
    fireEvent.change(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={(v) => calls.push(v)} entries={entries} />);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toContain("{quest.name}");
  });

  it("Esc closes the popup without insertion (the { stays)", () => {
    const calls: string[] = [];
    render(<PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(calls.at(-1)).toBe("{");
  });

  it("typing } closes the popup without auto-insertion", () => {
    const { rerender } = render(
      <PlaceholderInput value="" onChange={() => {}} entries={entries} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={() => {}} entries={entries} />);
    fireEvent.change(input, { target: { value: "{}" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("typing a space closes the popup; the `{ ` stays as typed", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={(v) => calls.push(v)} entries={entries} />);
    fireEvent.change(input, { target: { value: "{ " } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // onChange was called with "{ " — the space stays as typed, no insertion
    expect(calls.at(-1)).toBe("{ ");
  });

  it("backspacing past the original { closes the popup", () => {
    const { rerender } = render(
      <PlaceholderInput value="" onChange={() => {}} entries={entries} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });
    rerender(<PlaceholderInput value="{" onChange={() => {}} entries={entries} />);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows the empty-match row when query filters all out", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{xyz" } });
    expect(screen.getByText(/xyz/)).toBeInTheDocument();
  });

  it("shows the no-context message when there are zero entries to begin with", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={[]} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });
    expect(screen.getByText(/disponible|available/i)).toBeInTheDocument();
  });

  it("renders the hint below the input when entries is non-empty and the popup is closed", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    // Matches both the French and the English hint
    expect(screen.getByText(/ins[eé]rer|insert/i)).toBeInTheDocument();
  });

  it("hides the hint while the popup is open", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "{" } });
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
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "{" } });
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("PlaceholderInput styling", () => {
  it("applies the design-system input class", () => {
    const { container } = render(
      <PlaceholderInput value="" onChange={() => {}} entries={entries} />,
    );
    expect(container.querySelector("input")?.classList.contains("input")).toBe(true);
  });

  it("applies the design-system textarea class when multiline", () => {
    const { container } = render(
      <PlaceholderInput multiline value="" onChange={() => {}} entries={entries} />,
    );
    expect(container.querySelector("textarea")?.classList.contains("textarea")).toBe(true);
  });

  it("merges a caller className", () => {
    const { container } = render(
      <PlaceholderInput value="" onChange={() => {}} entries={entries} className="h-8" />,
    );
    const el = container.querySelector("input");
    expect(el?.classList.contains("input")).toBe(true);
    expect(el?.classList.contains("h-8")).toBe(true);
  });
});

describe("PlaceholderInput popup position", () => {
  it("anchors the popup to the field's left edge, not the caret", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    input.getBoundingClientRect = () =>
      ({ left: 120, right: 420, top: 30, bottom: 66, width: 300, height: 36 }) as DOMRect;
    fireEvent.change(input, {
      target: { value: "Une très longue valeur de titre déjà saisie {" },
    });
    const popup = screen.getByRole("listbox");
    expect(popup.style.left).toBe("120px");
    expect(popup.style.top).toBe("68px");
  });

  it("clamps the popup inside the viewport on narrow screens", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    input.getBoundingClientRect = () =>
      ({
        left: window.innerWidth - 50,
        right: window.innerWidth,
        top: 30,
        bottom: 66,
        width: 50,
        height: 36,
      }) as DOMRect;
    fireEvent.change(input, { target: { value: "{" } });
    const popup = screen.getByRole("listbox");
    expect(Number.parseFloat(popup.style.left) + 268).toBeLessThanOrEqual(window.innerWidth);
  });
});
