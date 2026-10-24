/**
 * Legacy color codes (`§6`, `&l`, `&#ff8800`, `§x§f§f§8§8§0§0`) to MiniMessage. The
 * plugin already reads `§` codes (`LenientText`); converting them once makes the text
 * editable in the rich view. A legacy color resets the formatting before it, hence the
 * `<reset>` when a decoration is on.
 */
const COLORS: Record<string, string> = {
  "0": "black",
  "1": "dark_blue",
  "2": "dark_green",
  "3": "dark_aqua",
  "4": "dark_red",
  "5": "dark_purple",
  "6": "gold",
  "7": "gray",
  "8": "dark_gray",
  "9": "blue",
  a: "green",
  b: "aqua",
  c: "red",
  d: "light_purple",
  e: "yellow",
  f: "white",
};

const FORMATS: Record<string, string> = {
  k: "obfuscated",
  l: "bold",
  m: "strikethrough",
  n: "underlined",
  o: "italic",
};

const CODE = /[§&](?:x(?:[§&][0-9a-f]){6}|#[0-9a-f]{6}|[0-9a-fk-or])/gi;

export function hasLegacyCodes(text: string): boolean {
  CODE.lastIndex = 0;
  return CODE.test(text);
}

export function legacyToMiniMessage(text: string): string {
  let formatted = false;
  let colored = false;
  return text.replace(CODE, (code) => {
    const body = code.slice(1).toLowerCase();
    let color: string | null = null;
    if (body.startsWith("x")) color = `#${body.replace(/[x§&]/g, "")}`;
    else if (body.startsWith("#")) color = body;
    else if (body in COLORS) color = COLORS[body]!;
    if (color) {
      const reset = formatted ? "<reset>" : "";
      formatted = false;
      colored = true;
      return `${reset}${color.startsWith("#") ? `<color:${color}>` : `<${color}>`}`;
    }
    if (body === "r") {
      const wasStyled = formatted || colored;
      formatted = false;
      colored = false;
      return wasStyled ? "<reset>" : "";
    }
    formatted = true;
    return `<${FORMATS[body]}>`;
  });
}
