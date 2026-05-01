/**
 * Tiny MiniMessage parser — sub-set sufficient for visual preview in the
 * editor. Supports:
 *
 *   - Named colors: <gold>, <red>, <aqua>, … (the 16 vanilla MC colors)
 *   - Hex colors:   <color:#ff5555>, <#ff5555>
 *   - Decorations:  <bold>, <italic>, <underlined>, <strikethrough>,
 *                   <obfuscated> (we render as italic — no real K1 glyph)
 *   - Reset:        <reset> closes every active style
 *   - Closing tags: </gold>, </bold>, …  (must match an open tag)
 *   - Escape:       \<  \>  \\
 *
 * Anything else (gradients, hover/click events, fonts, score, etc.) is left
 * as literal text — the parser does not throw on unknown tags. This is
 * intentional: the editor stays useful while the user types incomplete
 * markup, and Paper/Adventure handle the unsupported tags at runtime.
 */

export interface Style {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
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

const DECORATIONS = new Set([
  "bold",
  "b",
  "italic",
  "em",
  "i",
  "underlined",
  "u",
  "strikethrough",
  "st",
  "obfuscated",
  "obf",
]);

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

interface OpenTag {
  /** Canonical name we used to apply the style — for matching close tags. */
  name: string;
  /** Snapshot of the previous Style so we can restore on </tag>. */
  prev: Style;
}

const cloneStyle = (s: Style): Style => ({ ...s });

/** Parse a MiniMessage string into a flat list of styled segments. */
export function parseMiniMessage(input: string): Segment[] {
  const segments: Segment[] = [];
  let style: Style = {};
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
      // Escape: \< \> \\ — emit the next char literally.
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
      // Unterminated < — treat as literal.
      buf += ch;
      i++;
      continue;
    }
    const inner = input.slice(i + 1, close);
    const tag = inner.toLowerCase();
    i = close + 1;

    // Closing tag </name>
    if (tag.startsWith("/")) {
      const name = tag.slice(1);
      const idx = stack.findIndex((t) => t.name === name);
      if (idx === -1) {
        // No matching open — treat as literal.
        buf += `<${inner}>`;
        continue;
      }
      flush();
      // Restore style to what it was just before the matching open.
      style = cloneStyle(stack[idx]!.prev);
      stack.splice(idx);
      continue;
    }

    // <reset>
    if (tag === "reset") {
      flush();
      style = {};
      stack.length = 0;
      continue;
    }

    // <#hex> shortcut
    if (tag.startsWith("#") && isHex(tag)) {
      flush();
      stack.push({ name: tag, prev: cloneStyle(style) });
      style.color = tag;
      continue;
    }

    // <color:#hex> or <colour:#hex>
    if (tag.startsWith("color:") || tag.startsWith("colour:") || tag.startsWith("c:")) {
      const value = tag.split(":")[1] ?? "";
      const resolved = isHex(value) ? value : NAMED_COLORS[value];
      if (!resolved) {
        buf += `<${inner}>`;
        continue;
      }
      flush();
      stack.push({ name: "color", prev: cloneStyle(style) });
      style.color = resolved;
      continue;
    }

    // Named color shortcut: <gold>, <red>, …
    if (tag in NAMED_COLORS) {
      flush();
      stack.push({ name: tag, prev: cloneStyle(style) });
      style.color = NAMED_COLORS[tag]!;
      continue;
    }

    // Decoration shortcut: <bold>, <italic>, …
    if (DECORATIONS.has(tag)) {
      const key = decorationKey(tag);
      if (!key) {
        buf += `<${inner}>`;
        continue;
      }
      flush();
      stack.push({ name: tag, prev: cloneStyle(style) });
      style[key] = true as never;
      continue;
    }

    // Unknown tag — pass through as literal.
    buf += `<${inner}>`;
  }

  flush();
  return segments;
}

/** Strip all MiniMessage tags, returning just the displayed text. */
export function plainTextFromMiniMessage(input: string): string {
  return parseMiniMessage(input)
    .map((s) => s.text)
    .join("");
}
