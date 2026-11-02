import { describe, expect, it } from "vitest";
import {
  SERVER_PALETTE_KEYS,
  serverPaletteEntries,
  serverPaletteForm,
  serverPaletteFromConfig,
} from "./palettes";

describe("server palette", () => {
  const config = {
    [SERVER_PALETTE_KEYS.colors]: ["Brand #FF6B35", "Deep sea #0a3d62", "broken"],
    [SERVER_PALETTE_KEYS.gradients]: ["Sunset #ff5f6d #ffc371", "One #ffffff"],
  };

  it("reads named colors and gradients, skipping malformed entries", () => {
    const palette = serverPaletteFromConfig(config, "Serveur")!;
    expect(palette.name).toBe("Serveur");
    expect(palette.swatches.map((s) => [s.name, s.color])).toEqual([
      ["Brand", "#ff6b35"],
      ["Deep sea", "#0a3d62"],
    ]);
    expect(palette.gradients.map((g) => [g.name, g.stops])).toEqual([
      ["Sunset", ["#ff5f6d", "#ffc371"]],
    ]);
  });

  it("has no palette when the server has none or is offline", () => {
    expect(serverPaletteFromConfig(null, "S")).toBeNull();
    expect(
      serverPaletteFromConfig(
        { [SERVER_PALETTE_KEYS.colors]: [], [SERVER_PALETTE_KEYS.gradients]: [] },
        "S",
      ),
    ).toBeNull();
  });

  it("writes back the entries the plugin checks", () => {
    const form = serverPaletteForm(config);
    expect(serverPaletteEntries(form.swatches, form.gradients)).toEqual({
      colors: ["Brand #ff6b35", "Deep sea #0a3d62"],
      gradients: ["Sunset #ff5f6d #ffc371"],
    });
    expect(serverPaletteEntries([{ name: "  Two   words ", color: "#ABCDEF" }], [])).toEqual({
      colors: ["Two words #abcdef"],
      gradients: [],
    });
  });
});
