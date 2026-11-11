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

/**
 * The server's palette, in its `config.yml` (`text-palette.*`, ADR
 * `server-config-from-editor`): `"<name> #rrggbb"` per color, `"<name> #rrggbb #rrggbb…"`
 * per gradient. The plugin checks each entry on write.
 */
export const SERVER_PALETTE_KEYS = {
  colors: "text-palette.colors",
  gradients: "text-palette.gradients",
} as const;

const TRAILING_HEX = /(?:\s+#[0-9a-fA-F]{6})+$/;

/** `"Sunset #ff5f6d #ffc371"` → name and colors; null when the entry is malformed. */
function parseEntry(entry: string): { name: string; colors: string[] } | null {
  const m = TRAILING_HEX.exec(entry);
  if (!m) return null;
  const name = entry.slice(0, m.index).trim();
  if (!name) return null;
  return {
    name,
    colors: m[0]
      .trim()
      .split(/\s+/)
      .map((c) => c.toLowerCase()),
  };
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/** The server's palette from its reported config; null when it has none. */
export function serverPaletteFromConfig(
  config: Record<string, unknown> | null,
  name: string,
): Palette | null {
  if (!config) return null;
  const swatches: PaletteSwatch[] = [];
  for (const [k, e] of strings(config[SERVER_PALETTE_KEYS.colors]).entries()) {
    const p = parseEntry(e);
    if (p?.colors.length === 1) swatches.push({ id: `c${k}`, name: p.name, color: p.colors[0]! });
  }
  const gradients: PaletteGradient[] = [];
  for (const [k, e] of strings(config[SERVER_PALETTE_KEYS.gradients]).entries()) {
    const p = parseEntry(e);
    if (p && p.colors.length >= 2) gradients.push({ id: `g${k}`, name: p.name, stops: p.colors });
  }
  if (swatches.length === 0 && gradients.length === 0) return null;
  return { id: "server", name, swatches, gradients, styles: [] };
}

/** The config entries of a palette, as the plugin expects them. */
export function serverPaletteEntries(
  swatches: { name: string; color: string }[],
  gradients: { name: string; stops: string[] }[],
): { colors: string[]; gradients: string[] } {
  const clean = (name: string) => name.trim().replace(/\s+/g, " ");
  return {
    colors: swatches.map((s) => `${clean(s.name)} ${s.color.toLowerCase()}`),
    gradients: gradients.map(
      (g) => `${clean(g.name)} ${g.stops.map((c) => c.toLowerCase()).join(" ")}`,
    ),
  };
}

/** Parses the config entries back, for the palette's own form. */
export function serverPaletteForm(config: Record<string, unknown>): {
  swatches: { name: string; color: string }[];
  gradients: { name: string; stops: string[] }[];
} {
  return {
    swatches: strings(config[SERVER_PALETTE_KEYS.colors])
      .map(parseEntry)
      .filter((p): p is NonNullable<typeof p> => p?.colors.length === 1)
      .map((p) => ({ name: p.name, color: p.colors[0]! })),
    gradients: strings(config[SERVER_PALETTE_KEYS.gradients])
      .map(parseEntry)
      .filter((p): p is NonNullable<typeof p> => !!p && p.colors.length >= 2)
      .map((p) => ({ name: p.name, stops: p.colors })),
  };
}
