import { plainTextFromMiniMessage } from "@/lib/miniMessage";

/**
 * A lore as the plugin renders it (`MenuRenderer`): each line written is rendered on its
 * own, and a line whose `{…}` (or `%…%`) give nothing a player would see is dropped, so
 * a rule can sit on its own line. A line left empty as written stays.
 */
export function renderLore(src: string, render: (line: string) => string): string[] {
  return sourceLines(src).flatMap((line) => {
    const out = render(line);
    return isDynamic(line) && plainTextFromMiniMessage(out).trim() === "" ? [] : out.split("\n");
  });
}

/** The lines of a lore as written: a newline inside a `{…}` does not split it. */
export function sourceLines(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}" && depth > 0) depth--;
    else if (c === "\n" && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start));
  return out;
}

const isDynamic = (line: string) => line.includes("{") || line.includes("%");
