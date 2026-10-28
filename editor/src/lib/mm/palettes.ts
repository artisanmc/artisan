import { NAMED_COLORS } from "../miniMessage";

/**
 * Color sets, gradients and styles the toolbar offers. Applying one writes its colors
 * out (`<gradient:#f5d27a:#c9852b>`), never a reference: the text stays plain
 * MiniMessage, readable without Artisan, and a later palette change does not touch it.
 */
export interface PaletteSwatch {
  id: string;
  name: string;
  /** `#rrggbb`, or a vanilla color name (`gold`). */
  color: string;
}

export interface PaletteGradient {
  id: string;
  name: string;
  stops: string[];
  phase?: number;
}

/** A ready-made pair of tags: `<gradient:…><bold>` … `</bold></gradient>`. */
export interface PaletteStyle {
  id: string;
  name: string;
  open: string;
  close: string;
}

export interface Palette {
  id: string;
  name: string;
  swatches: PaletteSwatch[];
  gradients: PaletteGradient[];
  styles: PaletteStyle[];
}

/** Where palettes come from. Only a writable source is edited from the tools page. */
export interface PaletteSource {
  id: string;
  /** i18n key of the source's name. */
  labelKey: string;
  writable: boolean;
  load(): Promise<Palette[]>;
  save?(palettes: Palette[]): Promise<void>;
}

const VANILLA_ORDER = [
  "black",
  "dark_blue",
  "dark_green",
  "dark_aqua",
  "dark_red",
  "dark_purple",
  "gold",
  "gray",
  "dark_gray",
  "blue",
  "green",
  "aqua",
  "red",
  "light_purple",
  "yellow",
  "white",
];

export const VANILLA_PALETTE: Palette = {
  id: "vanilla",
  name: "Minecraft",
  swatches: VANILLA_ORDER.map((c) => ({ id: c, name: c, color: c })),
  gradients: [],
  styles: [],
};

export const ARTISAN_PALETTE: Palette = {
  id: "artisan",
  name: "Artisan",
  swatches: [
    { id: "ember", name: "Ember", color: "#ff6b35" },
    { id: "gold", name: "Gold", color: "#f5c542" },
    { id: "mint", name: "Mint", color: "#5ce1a6" },
    { id: "sky", name: "Sky", color: "#5ab4ff" },
    { id: "violet", name: "Violet", color: "#a77bff" },
    { id: "rose", name: "Rose", color: "#ff6fa8" },
    { id: "stone", name: "Stone", color: "#9aa0a6" },
    { id: "snow", name: "Snow", color: "#f4f6f8" },
  ],
  gradients: [
    { id: "fire", name: "Fire", stops: ["#ff3d00", "#ffb300"] },
    { id: "ice", name: "Ice", stops: ["#a8e6ff", "#4f8cff"] },
    { id: "gold", name: "Gold", stops: ["#f5d27a", "#c9852b"] },
    { id: "neon", name: "Neon", stops: ["#ff00d4", "#00e5ff"] },
    { id: "forest", name: "Forest", stops: ["#b4ec51", "#2e8b57"] },
    { id: "sunset", name: "Sunset", stops: ["#ff5f6d", "#ffc371"] },
    { id: "amethyst", name: "Amethyst", stops: ["#e0aaff", "#7b2cbf", "#3c096c"] },
  ],
  styles: [
    {
      id: "legendary",
      name: "Legendary",
      open: "<gradient:#f5d27a:#c9852b><bold>",
      close: "</bold></gradient>",
    },
    { id: "epic", name: "Epic", open: "<color:#a77bff><bold>", close: "</bold></color>" },
    { id: "muted", name: "Muted", open: "<gray><italic>", close: "</italic></gray>" },
  ],
};

export const BUILTIN_PALETTES: Palette[] = [VANILLA_PALETTE, ARTISAN_PALETTE];

export const builtinPaletteSource: PaletteSource = {
  id: "builtin",
  labelKey: "mmEditor.palettes.builtin",
  writable: false,
  load: async () => BUILTIN_PALETTES,
};

/** The hex a swatch draws with. */
export const swatchHex = (color: string): string =>
  color.startsWith("#") ? color : (NAMED_COLORS[color] ?? "#ffffff");
