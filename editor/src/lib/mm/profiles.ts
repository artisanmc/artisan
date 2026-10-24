import { type Style, parseMiniMessageSource } from "../miniMessage";
import { markupTokens, tagName } from "./tree";

/**
 * What a MiniMessage text may use where it is written. A profile is data: the toolbar,
 * the diagnostics and the preview all read the same one, so a lore never offers a
 * click and never previews as chat.
 */
export type MmFeature =
  | "color"
  | "gradient"
  | "decoration"
  | "shadow"
  | "font"
  | "click"
  | "hover"
  | "insert"
  | "newline"
  | "reset"
  | "translatable"
  | "selector"
  | "placeholder";

export type PreviewKind = "chat" | "tooltip" | "item-name" | "title" | "actionbar" | "motd";

export interface MmProfile {
  id: string;
  features: ReadonlySet<MmFeature>;
  /**
   * `single`: one line. `joined`: lines of one text, styles run on (chat, MOTD).
   * `separate`: each line parsed alone, as a lore's entries are.
   */
  lines: "single" | "joined" | "separate";
  /** Line cap (MOTD: 2). */
  maxLines?: number;
  /** What the game applies where no tag says otherwise. */
  defaults: Style;
  preview: PreviewKind;
  /** Lore wrap width in MC pixels (`lore_max_width`); 0 or absent: no wrap. */
  maxWidth?: number;
}

const ALL: MmFeature[] = [
  "color",
  "gradient",
  "decoration",
  "shadow",
  "font",
  "click",
  "hover",
  "insert",
  "newline",
  "reset",
  "translatable",
  "selector",
  "placeholder",
];
const STATIC = ALL.filter((f) => f !== "click" && f !== "hover" && f !== "insert");
const ONE_LINE = STATIC.filter((f) => f !== "newline");

export const CHAT: MmProfile = {
  id: "chat",
  features: new Set(ALL),
  lines: "joined",
  defaults: { color: "#ffffff" },
  preview: "chat",
};

/** The plugin drops the italic Minecraft puts on custom names and lores (`MenuRenderer`). */
export const ITEM_NAME: MmProfile = {
  id: "item-name",
  features: new Set(ONE_LINE),
  lines: "single",
  defaults: { color: "#ffffff", italic: false },
  preview: "item-name",
};

/** Lore is white and not italic, as Artisan renders it (`LenientText.loreLine`). */
export const LORE: MmProfile = {
  id: "lore",
  features: new Set(ONE_LINE),
  lines: "separate",
  defaults: { color: "#ffffff", italic: false },
  preview: "tooltip",
};

export const TITLE: MmProfile = {
  id: "title",
  features: new Set(ONE_LINE),
  lines: "single",
  defaults: { color: "#ffffff" },
  preview: "title",
};

export const ACTION_BAR: MmProfile = {
  id: "actionbar",
  features: new Set(ONE_LINE),
  lines: "single",
  defaults: { color: "#ffffff" },
  preview: "actionbar",
};

/** Server list MOTD: two lines, drawn in gray by the client. */
export const MOTD: MmProfile = {
  id: "motd",
  features: new Set(STATIC),
  lines: "joined",
  maxLines: 2,
  defaults: { color: "#808080" },
  preview: "motd",
};

const registry = new Map<string, MmProfile>();
for (const p of [CHAT, ITEM_NAME, LORE, TITLE, ACTION_BAR, MOTD]) registry.set(p.id, p);

/** Adds a profile (a module's own usage); the last registration of an id wins. */
export function registerMmProfile(profile: MmProfile): void {
  registry.set(profile.id, profile);
}

export function mmProfile(id: string): MmProfile | undefined {
  return registry.get(id);
}

export function mmProfiles(): MmProfile[] {
  return [...registry.values()];
}

const FEATURE_OF: Record<string, MmFeature> = {
  color: "color",
  gradient: "gradient",
  rainbow: "gradient",
  transition: "gradient",
  pride: "gradient",
  bold: "decoration",
  b: "decoration",
  italic: "decoration",
  i: "decoration",
  em: "decoration",
  underlined: "decoration",
  u: "decoration",
  strikethrough: "decoration",
  st: "decoration",
  obfuscated: "decoration",
  obf: "decoration",
  shadow: "shadow",
  font: "font",
  click: "click",
  hover: "hover",
  insert: "insert",
  newline: "newline",
  br: "newline",
  "br/": "newline",
  reset: "reset",
  key: "translatable",
  lang: "translatable",
  tr: "translatable",
  translate: "translatable",
  lang_or: "translatable",
  tr_or: "translatable",
  translate_or: "translatable",
  selector: "selector",
  sel: "selector",
  score: "selector",
  nbt: "selector",
  data: "selector",
};

/** The feature a tag name belongs to; named and hex colors are `color`. */
export function featureOfTag(name: string): MmFeature {
  const bare = name.replace(/^!/, "");
  return FEATURE_OF[bare] ?? "color";
}

export interface MmDiagnostic {
  from: number;
  to: number;
  code: "feature" | "lines";
  feature?: MmFeature;
}

/** How many lines the game shows at most for this profile, if it caps them. */
export const lineCap = (profile: MmProfile): number | undefined =>
  profile.lines === "single" ? 1 : profile.maxLines;

/** Where each line break the reader sees starts in `src`: a `\n`, `<newline>` or `<br>`. */
function lineBreaks(src: string, profile: MmProfile): number[] {
  const out: number[] = [];
  for (const seg of parseMiniMessageSource(src, profile.lines === "separate")) {
    for (let k = 0; k < seg.text.length; k++) {
      if (seg.text[k] === "\n") out.push(seg.gen ? seg.gen.from : seg.map[k]!);
    }
  }
  return out;
}

/** The lines the reader sees, tags that break a line included. */
export const lineCount = (src: string, profile: MmProfile): number =>
  lineBreaks(src, profile).length + 1;

/**
 * What the profile does not allow. Nothing is ever removed: a tag the game ignores here
 * stays in the text, flagged, since a module may rely on it elsewhere.
 */
export function diagnose(src: string, profile: MmProfile): MmDiagnostic[] {
  const out: MmDiagnostic[] = [];
  const segments = parseMiniMessageSource(src, profile.lines === "separate");
  for (const tk of markupTokens(src, segments)) {
    const { name, closing } = tagName(src.slice(tk.from, tk.to));
    if (closing) continue;
    const feature = featureOfTag(name);
    if (!profile.features.has(feature)) {
      out.push({ from: tk.from, to: tk.to, code: "feature", feature });
    }
  }
  const breaks = lineBreaks(src, profile);
  const cap = lineCap(profile);
  if (cap !== undefined && breaks.length >= cap) {
    out.push({ from: breaks[cap - 1]!, to: src.length, code: "lines" });
  }
  return out;
}
