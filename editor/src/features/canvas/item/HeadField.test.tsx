/**
 * Interaction tests for <HeadField> — the custom-head source select + value
 * input on a player_head state card.
 *
 * Regression: the field derived its source purely from the stored head, so
 * picking a source from a blank head produced "" → source snapped back to
 * "none" → the value input never rendered (feature unusable from blank). The
 * fix holds the chosen source in local state and only derives from the stored
 * value when it's non-empty. These tests pin that behavior.
 */
import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HeadField } from "./ItemHeadField";

/**
 * Controlled wrapper that holds `head` in state and feeds it back into
 * HeadField — reproduces the real re-render loop where a "" write would
 * unmount the input under the old logic.
 */
function ControlledHeadField({
  initial = "",
  onChange,
}: { initial?: string; onChange?: (v: string) => void }) {
  const [head, setHead] = useState(initial);
  return (
    <HeadField
      head={head}
      onChange={(v) => {
        setHead(v);
        onChange?.(v);
      }}
    />
  );
}

describe("HeadField", () => {
  it("blank state: picking 'hdb' renders the input without storing a non-empty value, then typing stores 'hdb:…'", () => {
    const onChange = vi.fn();
    render(<ControlledHeadField initial="" onChange={onChange} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "hdb" } });

    // The select must stay on hdb (not snap back to none) and NOT have stored
    // a non-empty head as a side effect of merely selecting the source.
    expect(select).toHaveValue("hdb");
    expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/\S/));

    // The value input now renders — type a value, which stores "hdb:128276".
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "128276" } });
    expect(onChange).toHaveBeenCalledWith("hdb:128276");
  });

  it("existing value: 'playerhead:Notch' shows playerhead in the select and Notch in the input", () => {
    render(<HeadField head="playerhead:Notch" onChange={() => {}} />);

    expect(screen.getByRole("combobox")).toHaveValue("playerhead");
    expect(screen.getByRole("textbox")).toHaveValue("Notch");
  });

  it("selecting 'none' with an existing value clears the head", () => {
    const onChange = vi.fn();
    render(<HeadField head="hdb:128276" onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "none" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("picking 'playerhead' on a blank head stores the viewing player placeholder", () => {
    const onChange = vi.fn();
    render(<ControlledHeadField initial="" onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "playerhead" } });

    // The viewer's head is the overwhelmingly common case, so choosing the
    // source is enough — no need to type a name first.
    expect(onChange).toHaveBeenCalledWith("playerhead:{player.name}");
    expect(screen.getByRole("textbox")).toHaveValue("{player.name}");
  });

  it("picking 'playerhead' over an existing value keeps that value (no viewer placeholder)", () => {
    const onChange = vi.fn();
    render(<HeadField head="hdb:128276" onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "playerhead" } });

    expect(onChange).toHaveBeenCalledWith("playerhead:128276");
  });

  it("the viewer-head button replaces a literal name with the placeholder", () => {
    const onChange = vi.fn();
    render(<ControlledHeadField initial="playerhead:Notch" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /current player|joueur actuel/i }));

    expect(onChange).toHaveBeenCalledWith("playerhead:{player.name}");
    expect(screen.getByRole("textbox")).toHaveValue("{player.name}");
  });

  it("clearing the input keeps the input mounted (does not unmount on empty head)", () => {
    render(<ControlledHeadField initial="hdb:128276" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("128276");

    fireEvent.change(input, { target: { value: "" } });

    // Store is now "" but the input must remain mounted (localSource stays hdb).
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("hdb");
  });
});
