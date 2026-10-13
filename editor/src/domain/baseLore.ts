import { deleteLText } from "@/lib/i18n";
import { addressedAppearances } from "./element";
import type { Appearance, LText, Project } from "./types";

/** Placeholder rendering the base item's lore where it is written. */
export const BASE_LORE_TOKEN = "{base.lore}";

/**
 * Removes a leading `{base.lore}` that has become useless.
 *
 * While an explicit lore overwrote the base item's lore, keeping the latter
 * required writing the placeholder — so the editor and the Boutique catalogue
 * migration inserted it everywhere, even where the author never asked for it.
 * Now that the base lore is kept by default, "`lore_mode: replace` +
 * `{base.lore}` on the first line" says exactly what the default says: it is
 * rewritten in its bare form.
 *
 * Strictly equivalent in rendering; a token anywhere other than the head
 * really positions the base lore and is left alone.
 */
export function normalizeBaseLore(project: Project): void {
  for (const menu of project.menus ?? [])
    for (const layer of menu.layers)
      for (const element of layer.elements)
        for (const appearance of addressedAppearances(element))
          normalizeAppearance(project, appearance);
  for (const source of project.dataSources ?? [])
    normalizeItemValues(project, source.shape === "table" ? source.rows : source.value);
}

function normalizeAppearance(project: Project, appearance: Appearance): void {
  if (appearance.loreMode !== "replace" || !appearance.lore) return;
  const values = project.i18nKeys[appearance.lore.key];
  const entries = Object.entries(values ?? {});
  if (entries.length === 0 || !entries.every(([, text]) => leads(text))) return;
  appearance.loreMode = undefined;
  if (entries.every(([, text]) => strip(text) === "")) {
    deleteLText(project, appearance.lore);
    appearance.lore = undefined;
    return;
  }
  for (const [lang, text] of entries) values![lang] = strip(text);
}

/**
 * Item values live deep inside source rows: recursive descent.
 *
 * A lore line there is a literal OR an `LText` node — the shape coming out of
 * import, each line carrying its own address. Both count: reading only
 * literals left real catalogues untouched.
 */
function normalizeItemValues(project: Project, value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) normalizeItemValues(project, entry);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.lore_mode === "replace" && record.lore !== undefined) {
    const lines = Array.isArray(record.lore) ? [...record.lore] : [record.lore];
    if (stripHead(project, lines)) {
      Reflect.deleteProperty(record, "lore_mode");
      if (lines.length === 0) Reflect.deleteProperty(record, "lore");
      else record.lore = lines;
    }
  }
  for (const entry of Object.values(record)) normalizeItemValues(project, entry);
}

/**
 * Removes the leading token from `lines` (mutated) and reports whether
 * anything moved. Emptied of its token, a line disappears — with its
 * translations, since each line's address is re-derived from its position on
 * write.
 */
function stripHead(project: Project, lines: unknown[]): boolean {
  const head = lines[0];
  if (typeof head === "string") {
    if (!leads(head)) return false;
    const rest = strip(head);
    if (rest === "") lines.shift();
    else lines[0] = rest;
    return true;
  }
  if (!head || typeof head !== "object" || !("key" in head)) return false;
  const lText = head as LText;
  const values = project.i18nKeys[lText.key];
  const entries = Object.entries(values ?? {});
  if (entries.length === 0 || !entries.every(([, text]) => leads(text))) return false;
  if (entries.every(([, text]) => strip(text) === "")) {
    deleteLText(project, lText);
    lines.shift();
    return true;
  }
  for (const [lang, text] of entries) values![lang] = strip(text);
  return true;
}

const leads = (text: string): boolean =>
  text === BASE_LORE_TOKEN || text.startsWith(`${BASE_LORE_TOKEN}\n`);

const strip = (text: string): string =>
  text === BASE_LORE_TOKEN ? "" : text.slice(BASE_LORE_TOKEN.length + 1);
