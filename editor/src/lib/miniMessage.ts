/**
 * MiniMessage parser — visual-preview subset.
 *
 * Supported (rendered):
 *   - Named colors: <gold>, <red>, <aqua>, … (16 vanilla MC colors)
 *   - Hex colors:   <color:#ff5555>, <#ff5555>, aliases <colour:>, <c:>
 *   - Decorations:  <bold>, <italic>, <underlined>, <strikethrough>,
 *                   <obfuscated>, with shorthands <b>/<em>/<i>/<u>/<st>/<obf>
 *   - Decoration negation: <!bold>, <!italic>, …
 *   - <reset>: closes every active style
 *   - <newline> / <br/>: inserts a "\n" character
 *   - <gradient:c1:c2[:c3:…][:phase]>: per-char linear interpolation
 *   - <rainbow[:!][:phase]>: per-char HSL cycle, "!" reverses
 *   - <pride[:flag][:phase]>: predefined gradient palette per flag
 *   - <transition:c1:c2[:c3:…][:phase]>: single color sampled from list
 *   - <shadow:color[:alpha]>: text-shadow (DOM renderer)
 *   - <font:[ns:]key>: font-family change in preview
 *   - <click:..>, <hover:..>, <insert:..>: marks scope as "interactive"
 *     (DOM renderer underlines + cursor pointer)
 *   - <key>, <lang>, <selector>, <score>, <nbt>: emit a literal placeholder
 *     like [key.jump] so the user sees where runtime-replacement happens
 *   - Escapes: \< \> \\
 *   - Closing tags </gold>, </bold>, … must match an open tag
 *
 * Skipped (would need extra assets/data — passed through as literal text):
 *   <sprite>, <head>
 */

export interface Shadow {
  color: string;
  alpha: number;
}

export interface Style {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  shadow?: Shadow;
  font?: string;
  /** True when inside <click>/<hover>/<insert> — DOM renderer hints with
   *  underline + cursor:pointer. */
  interactive?: boolean;
}

export interface Segment {
  text: string;
  style: Style;
}

/**
 * A segment that knows where its text comes from: `map[k]` is the source offset of
 * `text[k]` (UTF-16 units), or -1 for text the source does not hold verbatim. Text a
 * tag emits (`<newline>`, the `[key.jump]` of a `<key>`) carries `gen`, the range of
 * that tag. What no segment covers is markup — what the rich editor hides.
 */
export interface SourceSegment extends Segment {
  map: number[];
  gen?: { from: number; to: number };
}

export const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  dark_blue: "#0000aa",
  dark_green: "#00aa00",
  dark_aqua: "#00aaaa",
  dark_red: "#aa0000",
  dark_purple: "#aa00aa",
  gold: "#ffaa00",
  gray: "#aaaaaa",
  grey: "#aaaaaa",
  dark_gray: "#555555",
  dark_grey: "#555555",
  blue: "#5555ff",
  green: "#55ff55",
  aqua: "#55ffff",
  red: "#ff5555",
  light_purple: "#ff55ff",
  yellow: "#ffff55",
  white: "#ffffff",
};

const decorationKey = (tag: string): keyof Style | null => {
  switch (tag) {
    case "bold":
    case "b":
      return "bold";
    case "italic":
    case "em":
    case "i":
      return "italic";
    case "underlined":
    case "u":
      return "underlined";
    case "strikethrough":
    case "st":
      return "strikethrough";
    case "obfuscated":
    case "obf":
      return "obfuscated";
    default:
      return null;
  }
};

const isHex = (s: string): boolean => /^#[0-9a-f]{6}$/i.test(s);

const cloneStyle = (s: Style): Style => ({ ...s, shadow: s.shadow ? { ...s.shadow } : undefined });

const resolveColor = (token: string): string | undefined => {
  if (isHex(token)) return token.toLowerCase();
  return NAMED_COLORS[token.toLowerCase()];
};

interface OpenTag {
  /** Canonical name we used to apply the style — for matching close tags. */
  name: string;
  /** Snapshot of the previous Style so we can restore on </tag>. */
  prev: Style;
}

/* --- color utilities for gradient / rainbow ----------------------------- */

const hexToRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const rgbToHex = (r: number, g: number, b: number): string => {
  const c = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
};

const mixHex = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
};

const sampleGradient = (colors: string[], t: number): string => {
  // t in [0, 1]
  if (colors.length === 1) return colors[0] ?? "#ffffff";
  const segCount = colors.length - 1;
  const idx = Math.min(Math.floor(t * segCount), segCount - 1);
  const local = t * segCount - idx;
  return mixHex(colors[idx]!, colors[idx + 1]!, local);
};

const hsvToHex = (h: number, s: number, v: number): string => {
  // h in [0, 1], s and v in [0, 1]
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const tt = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = tt;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = tt;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = tt;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return rgbToHex(r * 255, g * 255, b * 255);
};

/* --- tag-arg helpers ---------------------------------------------------- */

const splitTagArgs = (raw: string): string[] => {
  // raw is the whole tag content (after `<`, before `>`), e.g. "gradient:red:gold:0.5".
  return raw.split(":");
};

const parseGradientArgs = (parts: string[]): { colors: string[]; phase: number } | null => {
  // parts[0] is "gradient"; the rest are colors and an optional trailing phase.
  const rest = parts.slice(1);
  if (rest.length === 0) return null;
  const last = rest[rest.length - 1]!;
  let phase = 0;
  let colorTokens = rest;
  if (!resolveColor(last) && !Number.isNaN(Number(last))) {
    phase = Number(last);
    colorTokens = rest.slice(0, -1);
  }
  const colors = colorTokens.map((t) => resolveColor(t)).filter((c): c is string => Boolean(c));
  if (colors.length < 1) return null;
  return { colors, phase };
};

const parseRainbowArgs = (parts: string[]): { phase: number; reverse: boolean } => {
  const args = parts.slice(1);
  let phase = 0;
  let reverse = false;
  for (const a of args) {
    if (a === "!") reverse = true;
    else if (!Number.isNaN(Number(a))) phase = Number(a);
  }
  return { phase, reverse };
};

const parseShadowArgs = (parts: string[]): Shadow | null => {
  // parts[0] = "shadow", parts[1] = color, parts[2]? = alpha
  if (parts.length < 2) return null;
  const color = resolveColor(parts[1]!);
  if (!color) return null;
  const alpha = parts.length > 2 ? Number(parts[2]) : 0.25;
  if (Number.isNaN(alpha)) return null;
  return { color, alpha };
};

/* --- pride flag palettes ------------------------------------------------ */

const PRIDE_PALETTES: Record<string, string[]> = {
  // Default 6-stripe pride flag.
  pride: ["#e50000", "#ff8d00", "#ffee00", "#028121", "#004cff", "#770088"],
  queer: ["#e50000", "#ff8d00", "#ffee00", "#028121", "#004cff", "#770088"],
  // Trans flag.
  trans: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"],
  transgender: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"],
  // Non-binary.
  nb: ["#fff430", "#ffffff", "#9c59d1", "#000000"],
  nonbinary: ["#fff430", "#ffffff", "#9c59d1", "#000000"],
  // Bisexual.
  bi: ["#d60270", "#9b4f96", "#0038a8"],
  bisexual: ["#d60270", "#9b4f96", "#0038a8"],
  // Pansexual.
  pan: ["#ff1b8d", "#ffd700", "#1bb3ff"],
  pansexual: ["#ff1b8d", "#ffd700", "#1bb3ff"],
  // Lesbian.
  lesbian: ["#d62900", "#ff9b55", "#ffffff", "#d461a6", "#a50062"],
  // Gay (mlm).
  gay: ["#078d70", "#26ceaa", "#98e8c1", "#ffffff", "#7bade2", "#5049cc", "#3d1a78"],
  mlm: ["#078d70", "#26ceaa", "#98e8c1", "#ffffff", "#7bade2", "#5049cc", "#3d1a78"],
  // Asexual.
  ace: ["#000000", "#a3a3a3", "#ffffff", "#800080"],
  asexual: ["#000000", "#a3a3a3", "#ffffff", "#800080"],
  // Aromantic.
  aro: ["#3da542", "#a7d379", "#ffffff", "#a9a9a9", "#000000"],
  aromantic: ["#3da542", "#a7d379", "#ffffff", "#a9a9a9", "#000000"],
  // Genderfluid.
  fluid: ["#ff75a2", "#ffffff", "#be18d6", "#000000", "#333ebd"],
  genderfluid: ["#ff75a2", "#ffffff", "#be18d6", "#000000", "#333ebd"],
};

const parsePrideArgs = (parts: string[]): { palette: string[]; phase: number } => {
  // parts[0] = "pride"; rest = optional flag, optional phase.
  let palette: string[] = PRIDE_PALETTES.pride!;
  let phase = 0;
  for (const a of parts.slice(1)) {
    if (a in PRIDE_PALETTES) palette = PRIDE_PALETTES[a]!;
    else if (!Number.isNaN(Number(a))) phase = Number(a);
  }
  return { palette, phase };
};

const parseTransitionArgs = (parts: string[]): { colors: string[]; phase: number } | null =>
  parseGradientArgs(parts);

/* --- placeholder generators for server-rendered tags -------------------- */

const placeholderFor = (head: string, parts: string[]): string => {
  // [foo:bar] — gives the user something visible without pretending it's real
  // content. We strip the head when it's redundant for legibility.
  switch (head) {
    case "key":
      return `[${parts.slice(1).join(":")}]`;
    case "lang":
    case "tr":
    case "translate":
      return `[lang:${parts.slice(1).join(":")}]`;
    case "lang_or":
    case "tr_or":
    case "translate_or":
      // <lang_or:key:fallback…> — show the fallback if present.
      return parts[2] ? parts[2].replace(/^['"]|['"]$/g, "") : `[lang:${parts[1] ?? ""}]`;
    case "selector":
    case "sel":
      return `[${parts.slice(1).join(":")}]`;
    case "score":
      return `[score:${parts.slice(1).join(":")}]`;
    case "nbt":
    case "data":
      return `[nbt:${parts.slice(1).join(":")}]`;
    default:
      return `[${head}]`;
  }
};

export const SELF_REPLACING = new Set([
  "key",
  "lang",
  "tr",
  "translate",
  "lang_or",
  "tr_or",
  "translate_or",
  "selector",
  "sel",
  "score",
  "nbt",
  "data",
]);

const INTERACTIVE = new Set(["click", "hover", "insert"]);

/* --- per-character explosion for gradient/rainbow ----------------------- */

const explodePerChar = (segs: SourceSegment[]): SourceSegment[] => {
  const out: SourceSegment[] = [];
  for (const seg of segs) {
    let k = 0;
    for (const ch of seg.text) {
      out.push({
        text: ch,
        style: cloneStyle(seg.style),
        map: seg.map.slice(k, k + ch.length),
        ...(seg.gen ? { gen: seg.gen } : {}),
      });
      k += ch.length;
    }
  }
  return out;
};

const applyGradient = (segs: SourceSegment[], colors: string[], phase: number): SourceSegment[] => {
  const exploded = explodePerChar(segs);
  // Distribute uniformly across all chars. Phase shifts the t mapping but
  // the gradient is bounded — clamp instead of wrap so t=1 hits the last
  // color exactly when phase=0 (otherwise it would alias back to the first).
  const total = exploded.length;
  if (total === 0) return exploded;
  for (let i = 0; i < total; i++) {
    const t = total === 1 ? 0 : i / (total - 1);
    const shifted = Math.max(0, Math.min(1, t + phase));
    exploded[i]!.style.color = sampleGradient(colors, shifted);
  }
  return exploded;
};

const applyRainbow = (segs: SourceSegment[], phase: number, reverse: boolean): SourceSegment[] => {
  const exploded = explodePerChar(segs);
  const total = exploded.length;
  if (total === 0) return exploded;
  // Use i/total (not i/(total-1)) so the last char doesn't wrap back to the
  // first char's hue — keep them visibly distinct on short strings.
  for (let i = 0; i < total; i++) {
    const baseT = i / total;
    const direction = reverse ? -1 : 1;
    const shifted = (((baseT * direction + phase) % 1) + 1) % 1;
    exploded[i]!.style.color = hsvToHex(shifted, 0.9, 1);
  }
  return exploded;
};

/* --- scope helpers for tags that wrap nested content ------------------- */

const findMatchingClose = (input: string, startIdx: number, tagName: string): number => {
  let depth = 1;
  let i = startIdx;
  while (i < input.length) {
    const open = input.indexOf("<", i);
    if (open === -1) return -1;
    const close = input.indexOf(">", open + 1);
    if (close === -1) return -1;
    const inner = input.slice(open + 1, close).toLowerCase();
    if (inner === `/${tagName}`) {
      depth--;
      if (depth === 0) return open;
    } else if (inner === tagName || inner.startsWith(`${tagName}:`)) {
      depth++;
    }
    i = close + 1;
  }
  return -1;
};

/**
 * Returns the inner content + position to resume parsing for a wrapping tag.
 * If the matching `</tag>` is found, scope ends right before it. If there's
 * no closing tag (the user chose to leave it open, e.g. "<rainbow>just text"),
 * the scope extends to the end of the input — matching Adventure semantics
 * where these tags apply to the rest of the message until reset/EOF.
 */
const scopeOf = (
  input: string,
  startIdx: number,
  tagName: string,
): { content: string; next: number } => {
  const closeAt = findMatchingClose(input, startIdx, tagName);
  if (closeAt === -1) return { content: input.slice(startIdx), next: input.length };
  return { content: input.slice(startIdx, closeAt), next: closeAt + `</${tagName}>`.length };
};

/* --- main parser -------------------------------------------------------- */

interface ParseContext {
  startStyle: Style;
  /** Source offset of `input[0]`: nested scopes are parsed from a slice. */
  base: number;
}

function parseFragment(input: string, ctx: ParseContext): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let style: Style = cloneStyle(ctx.startStyle);
  const stack: OpenTag[] = [];
  const base = ctx.base;
  let buf = "";
  let bufMap: number[] = [];
  let tagStart = 0;

  const flush = () => {
    if (buf.length > 0) {
      segments.push({ text: buf, style: cloneStyle(style), map: bufMap });
      buf = "";
      bufMap = [];
    }
  };
  /** Appends `input[from, to)` verbatim — an unknown tag stays literal text. */
  const literal = (from: number, to: number) => {
    buf += input.slice(from, to);
    for (let k = from; k < to; k++) bufMap.push(base + k);
  };
  const literalTag = () => literal(tagStart, i);
  /** Text a tag stands for, attached to the tag's source range. */
  const generated = (text: string) => {
    segments.push({
      text,
      style: cloneStyle(style),
      map: new Array(text.length).fill(-1),
      gen: { from: base + tagStart, to: base + i },
    });
  };
  const nested = (content: string, startStyle: Style) =>
    parseFragment(content, { startStyle, base: base + i });

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\\" && i + 1 < input.length) {
      buf += input[i + 1];
      bufMap.push(base + i + 1);
      i += 2;
      continue;
    }
    if (ch !== "<") {
      literal(i, i + 1);
      i++;
      continue;
    }
    const close = input.indexOf(">", i + 1);
    if (close === -1) {
      literal(i, i + 1);
      i++;
      continue;
    }
    const innerRaw = input.slice(i + 1, close);
    const tagLower = innerRaw.toLowerCase();
    const parts = splitTagArgs(tagLower);
    const head = parts[0] ?? "";
    tagStart = i;
    i = close + 1;

    // Closing tag </name>
    if (head.startsWith("/")) {
      const name = head.slice(1);
      const idx = stack.findIndex((t) => t.name === name);
      if (idx === -1) {
        literalTag();
        continue;
      }
      flush();
      style = cloneStyle(stack[idx]!.prev);
      stack.splice(idx);
      continue;
    }

    // <reset>
    if (tagLower === "reset") {
      flush();
      style = {};
      stack.length = 0;
      continue;
    }

    // <newline> / <br/>
    if (tagLower === "newline" || tagLower === "br" || tagLower === "br/") {
      flush();
      generated("\n");
      continue;
    }

    // <gradient:...> — applies to rest of input if no closing tag found.
    if (head === "gradient") {
      const args = parseGradientArgs(parts);
      if (!args) {
        literalTag();
        continue;
      }
      const scope = scopeOf(input, i, "gradient");
      flush();
      const inner = nested(scope.content, style);
      segments.push(...applyGradient(inner, args.colors, args.phase));
      i = scope.next;
      continue;
    }

    // <rainbow[:!][:phase]>
    if (head === "rainbow") {
      const args = parseRainbowArgs(parts);
      const scope = scopeOf(input, i, "rainbow");
      flush();
      const inner = nested(scope.content, style);
      segments.push(...applyRainbow(inner, args.phase, args.reverse));
      i = scope.next;
      continue;
    }

    // <pride[:flag][:phase]>
    if (head === "pride") {
      const args = parsePrideArgs(parts);
      const scope = scopeOf(input, i, "pride");
      flush();
      const inner = nested(scope.content, style);
      segments.push(...applyGradient(inner, args.palette, args.phase));
      i = scope.next;
      continue;
    }

    // <transition:c1:c2:…[:phase]>
    if (head === "transition") {
      const args = parseTransitionArgs(parts);
      if (!args) {
        literalTag();
        continue;
      }
      const scope = scopeOf(input, i, "transition");
      flush();
      const inner = nested(scope.content, style);
      const sampled = sampleGradient(args.colors, Math.max(0, Math.min(1, (args.phase + 1) / 2)));
      const recolored = inner.map((seg) => ({ ...seg, style: { ...seg.style, color: sampled } }));
      segments.push(...recolored);
      i = scope.next;
      continue;
    }

    // <font:[ns:]key>
    if (head === "font") {
      const fontKey = parts.slice(1).join(":") || "minecraft:default";
      const scope = scopeOf(input, i, "font");
      flush();
      const inner = nested(scope.content, { ...style, font: fontKey });
      segments.push(...inner);
      i = scope.next;
      continue;
    }

    // <click:...>, <hover:...>, <insert:...>
    if (INTERACTIVE.has(head)) {
      const scope = scopeOf(input, i, head);
      flush();
      const inner = nested(scope.content, { ...style, interactive: true });
      segments.push(...inner);
      i = scope.next;
      continue;
    }

    // Self-replacing data tags — emit a placeholder text segment.
    if (SELF_REPLACING.has(head)) {
      flush();
      generated(placeholderFor(head, parts));
      continue;
    }

    // <shadow:color[:alpha]>
    if (head === "shadow") {
      const shadow = parseShadowArgs(parts);
      if (!shadow) {
        literalTag();
        continue;
      }
      flush();
      stack.push({ name: "shadow", prev: cloneStyle(style) });
      style.shadow = shadow;
      continue;
    }

    // <#hex>
    if (head.startsWith("#") && isHex(head)) {
      flush();
      stack.push({ name: head, prev: cloneStyle(style) });
      style.color = head;
      continue;
    }

    // <color:...> / <colour:...> / <c:...>
    if (head === "color" || head === "colour" || head === "c") {
      const value = parts[1] ?? "";
      const resolved = resolveColor(value);
      if (!resolved) {
        literalTag();
        continue;
      }
      flush();
      stack.push({ name: "color", prev: cloneStyle(style) });
      style.color = resolved;
      continue;
    }

    // Decoration negation <!bold>, <!italic>, …
    if (head.startsWith("!")) {
      const key = decorationKey(head.slice(1));
      if (!key) {
        literalTag();
        continue;
      }
      flush();
      stack.push({ name: head, prev: cloneStyle(style) });
      style[key] = false as never;
      continue;
    }

    // Named color shortcut: <gold>, <red>, …
    if (head in NAMED_COLORS) {
      flush();
      stack.push({ name: head, prev: cloneStyle(style) });
      style.color = NAMED_COLORS[head]!;
      continue;
    }

    // Decoration shortcut: <bold>, <italic>, …
    const decoKey = decorationKey(head);
    if (decoKey) {
      flush();
      stack.push({ name: head, prev: cloneStyle(style) });
      style[decoKey] = true as never;
      continue;
    }

    // Unknown tag — pass through as literal so the editor stays usable.
    literalTag();
  }

  flush();
  return segments;
}

export function parseMiniMessage(input: string): Segment[] {
  return parseFragment(input, { startStyle: {}, base: 0 }).map(({ text, style }) => ({
    text,
    style,
  }));
}

/**
 * {@link parseMiniMessage} with each segment's source offsets. `perLine` parses every
 * line alone, as the game does for a lore (a tag never carries over to the next entry).
 */
export function parseMiniMessageSource(input: string, perLine = false): SourceSegment[] {
  if (!perLine) return parseFragment(input, { startStyle: {}, base: 0 });
  const out: SourceSegment[] = [];
  let base = 0;
  for (const line of input.split("\n")) {
    if (base > 0) out.push({ text: "\n", style: {}, map: [base - 1] });
    out.push(...parseFragment(line, { startStyle: {}, base }));
    base += line.length + 1;
  }
  return out;
}

/** Strip all MiniMessage tags, returning just the displayed text. */
export function plainTextFromMiniMessage(input: string): string {
  return parseMiniMessage(input)
    .map((s) => s.text)
    .join("");
}
