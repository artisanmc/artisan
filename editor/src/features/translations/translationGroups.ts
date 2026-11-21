import type { TranslationRow } from "@/lib/i18nUsages";

/**
 * Where a row of the Translations panel belongs: the Document that holds it
 * (`menus.calendar`, `commands.daily`, `variants.bedrock.menus.calendar`), the
 * data source (`sources.rewards`), the first segment of a key no Document holds
 * (`claim`, `artisan`: a plugin's messages, Artisan's durations), or the
 * leftovers.
 */
export type TranslationGroupKind = "document" | "lang" | "langRoot" | "unused";

export interface TranslationGroup {
  id: string;
  kind: TranslationGroupKind;
  rows: TranslationRow[];
}

const UNUSED = "(unused)";
const LANG_ONLY = "(lang/ only)";

/** `menus.calendar.elements.x.default.lore` → `menus.calendar`; `commands.daily claim.description` → `commands.daily`. */
function documentOf(context: string): string {
  const segments = context.split(".");
  const at = segments[0] === "variants" ? 2 : 0;
  const kind = segments[at];
  const id = segments[at + 1]?.split(/[\s[]/)[0];
  if (!kind || !id) return context;
  return [...segments.slice(0, at), kind, id].join(".");
}

function groupOf(row: TranslationRow): { id: string; kind: TranslationGroupKind } {
  if (row.context === UNUSED) return { id: UNUSED, kind: "unused" };
  if (row.context === LANG_ONLY) {
    const dot = row.key.indexOf(".");
    // A key at the file's root (`reminder`, `unlocked`): a plugin's top-level messages.
    return dot < 0 ? { id: "", kind: "langRoot" } : { id: row.key.slice(0, dot), kind: "lang" };
  }
  return { id: documentOf(row.context), kind: "document" };
}

/**
 * The rows by group, in the rows' order (`translationRowsBuilder` sorts them by
 * context, then key): Documents and sources first, then the keys only `lang/`
 * holds, then the leftovers. A long list reads as one section per menu.
 */
export function groupRows(rows: ReadonlyArray<TranslationRow>): TranslationGroup[] {
  const groups = new Map<string, TranslationGroup>();
  for (const row of rows) {
    const { id, kind } = groupOf(row);
    const at = `${kind}:${id}`;
    let group = groups.get(at);
    if (!group) {
      group = { id, kind, rows: [] };
      groups.set(at, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

/** Whether [row] matches every word of [query], in its key, place, source or translation. */
export function rowMatches(row: TranslationRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${row.key}\n${row.context}\n${row.source}\n${row.target}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
