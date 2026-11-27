import { paletteOf } from "@/lib/pack/palette";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayerTint } from "./LayerTint";

const palette = paletteOf([]);
const names = ["neutral", "primary"];

describe("LayerTint", () => {
  it("takes the tint off, and says a name no palette holds", () => {
    const onChange = vi.fn();
    render(<LayerTint value="frost" names={names} palette={palette} onChange={onChange} />);
    // The name stays chosen: nothing is rewritten by opening the layer.
    expect(screen.getByLabelText("Teinte")).toHaveValue("frost");
    expect(screen.getByText(/ne nomme une couleur « frost »/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Teinte"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("starts a colour of its own from white when no name was chosen", () => {
    const onChange = vi.fn();
    render(<LayerTint value={undefined} names={names} palette={palette} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Teinte"), { target: { value: "#" } });
    expect(onChange).toHaveBeenCalledWith("#ffffff");
  });
});
