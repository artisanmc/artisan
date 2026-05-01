/**
 * MiniMessage parser — visual-preview subset.
 *
 * Supported (rendered):
 *   - Named colors: <gold>, <red>, <aqua>, … (16 vanilla MC colors)
 *   - Hex colors:   <color:#ff5555>, <#ff5555>, aliases <colour:>, <c:>
 *   - Decorations:  <bold>, <italic>, <underlined>, <strikethrough>,
 *                   <obfuscated>, with shorthands <b>/<em>/<i>/<u>/<st>/<obf>
 *   - Decoration negation: <!bold>, <!italic>, … (turns the decoration off
 *                          inside its scope)
 *   - <reset>: closes every active style
 *   - <newline> / <br/>: inserts a "\n" character
 *   - <gradient:c1:c2[:c3:…][:phase]>: per-character linear interpolation
 *   - <rainbow[:!][:phase]>: per-character HSL cycle, "!" reverses
 *   - <shadow:color[:alpha]>: stored on the style for the DOM renderer
 *                              (Konva renderer ignores for now)
 *   - Escapes: \< \> \\
 *   - Closing tags </gold>, </bold>, … must match an open tag
 *
 * Anything else (click/hover/key/lang/insert/selector/score/nbt/font/sprite/
 * head/transition/pride/etc.) is left as literal text — the parser does not
 * throw on unknown tags so the editor stays usable while typing.
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
}

export interface Segment {
  text: string;
  style: Style;
}

const NAMED_COLORS: Record<string, string> = {
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

/* --- per-character explosion for gradient/rainbow ----------------------- */

const explodePerChar = (segs: Segment[]): Segment[] => {
  const out: Segment[] = [];
  for (const seg of segs) {
    for (const ch of seg.text) out.push({ text: ch, style: cloneStyle(seg.style) });
  }
  return out;
};

const applyGradient = (segs: Segment[], colors: string[], phase: number): Segment[] => {
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

const applyRainbow = (segs: Segment[], phase: number, reverse: boolean): Segment[] => {
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

/* --- matching-close finder for tags that wrap nested content ------------ */

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

/* --- main parser -------------------------------------------------------- */

interface ParseContext {
  startStyle: Style;
}

function parseFragment(input: string, ctx: ParseContext): Segment[] {
  const segments: Segment[] = [];
  let style: Style = cloneStyle(ctx.startStyle);
  const stack: OpenTag[] = [];
  let buf = "";

  const flush = () => {
    if (buf.length > 0) {
      segments.push({ text: buf, style: cloneStyle(style) });
      buf = "";
    }
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\\" && i + 1 < input.length) {
      buf += input[i + 1];
      i += 2;
      continue;
    }
    if (ch !== "<") {
      buf += ch;
      i++;
      continue;
    }
    const close = input.indexOf(">", i + 1);
    if (close === -1) {
      buf += ch;
      i++;
      continue;
    }
    const innerRaw = input.slice(i + 1, close);
    const tagLower = innerRaw.toLowerCase();
    const parts = splitTagArgs(tagLower);
    const head = parts[0] ?? "";
    i = close + 1;

    // Closing tag </name>
    if (head.startsWith("/")) {
      const name = head.slice(1);
      const idx = stack.findIndex((t) => t.name === name);
      if (idx === -1) {
        buf += `<${innerRaw}>`;
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
      segments.push({ text: "\n", style: cloneStyle(style) });
      continue;
    }

    // <gradient:...> — recursive scope
    if (head === "gradient") {
      const args = parseGradientArgs(parts);
      const closeAt = findMatchingClose(input, i, "gradient");
      if (!args || closeAt === -1) {
        buf += `<${innerRaw}>`;
        continue;
      }
      const innerContent = input.slice(i, closeAt);
      flush();
      const inner = parseFragment(innerContent, { startStyle: style });
      segments.push(...applyGradient(inner, args.colors, args.phase));
      i = closeAt + "</gradient>".length;
      continue;
    }

    // <rainbow[:!][:phase]>
    if (head === "rainbow") {
      const args = parseRainbowArgs(parts);
      const closeAt = findMatchingClose(input, i, "rainbow");
      if (closeAt === -1) {
        buf += `<${innerRaw}>`;
        continue;
      }
      const innerContent = input.slice(i, closeAt);
      flush();
      const inner = parseFragment(innerContent, { startStyle: style });
      segments.push(...applyRainbow(inner, args.phase, args.reverse));
      i = closeAt + "</rainbow>".length;
      continue;
    }

    // <shadow:color[:alpha]>
    if (head === "shadow") {
      const shadow = parseShadowArgs(parts);
      if (!shadow) {
        buf += `<${innerRaw}>`;
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
        buf += `<${innerRaw}>`;
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
        buf += `<${innerRaw}>`;
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
    buf += `<${innerRaw}>`;
  }

  flush();
  return segments;
}

export function parseMiniMessage(input: string): Segment[] {
  return parseFragment(input, { startStyle: {} });
}

/** Strip all MiniMessage tags, returning just the displayed text. */
export function plainTextFromMiniMessage(input: string): string {
  return parseMiniMessage(input)
    .map((s) => s.text)
    .join("");
}
