import { visitProjectLTexts } from "@/domain/i18nSites";
import type { I18nKey, Project } from "@/domain/types";

/**
 * Label every LText reference in a pack with a dotted-path "context" string
 * describing where it sits in the tree. Used by the Translations panel — both
 * as inline metadata in the table and as comments in the YAML copy output (so
 * an AI / human translator knows the register of each string).
 *
 * Thin fold over the single pack traversal in `@/domain/i18nSites`; the path
 * vocabulary (`menus.<id>.title`, `…click.<type>.message`, `…body[i]`) lives
 * there as each site's `path`.
 */
export function findKeyUsages(pack: Project): Map<I18nKey, string> {
  const out = new Map<I18nKey, string>();
  for (const site of visitProjectLTexts(pack)) out.set(site.lText.key, site.path);
  return out;
}

const UNUSED_CONTEXT = "(unused)";

/**
 * All i18n keys present in the pack's translation map that no longer have a
 * reference anywhere in the tree (menus, commands, templates, dialogs). These
 * are stale leftovers from deleted elements / re-imports — safe to drop. Used
 * by the Translations panel's "remove unused" cleanup.
 */
export function findUnusedI18nKeys(pack: Project): I18nKey[] {
  const used = findKeyUsages(pack);
  return (Object.keys(pack.i18nKeys) as I18nKey[]).filter((key) => !used.has(key));
}

/**
 * Build the list of rows for the Translations panel. Each row has
 *   - the LText key
 *   - the dotted-path context (or "(unused)" if the key is orphaned —
 *     can happen with imports or stale entries that the GC missed)
 *   - the source value (defaultLang) — empty if missing
 *   - the target value (activeLang) — empty if missing
 *
 * Orphaned keys are kept in the list so the user can clean them up
 * manually if they care; they're typically harmless.
 */
export interface TranslationRow {
  key: I18nKey;
  context: string;
  source: string;
  target: string;
}
/**
 * Enumerate all languages present in a pack's i18n map, including the
 * default. Result is stable-ordered: defaultLang first, then the rest
 * alphabetically. A pack with zero translations still returns
 * `[defaultLang]` so the UI can still render the source-edit tab.
 */
export function listLanguages(pack: Project): string[] {
  const langs = new Set<string>([pack.defaultLang]);
  for (const entry of Object.values(pack.i18nKeys)) {
    if (!entry) continue;
    for (const lang of Object.keys(entry)) langs.add(lang);
  }
  const others = Array.from(langs)
    .filter((l) => l !== pack.defaultLang)
    .sort();
  return [pack.defaultLang, ...others];
}

/**
 * For every non-default language in the pack, count how many keys lack
 * a translation (missing entirely or empty string). Used by the
 * Translations panel tab badges and by the top-bar Languages button
 * dot indicator. Default lang is intentionally excluded — its values
 * are the source, there's nothing to "miss".
 */
export function countMissingPerLang(pack: Project): Record<string, number> {
  const out: Record<string, number> = {};
  const allEntries = Object.values(pack.i18nKeys);
  for (const lang of listLanguages(pack)) {
    if (lang === pack.defaultLang) continue;
    let count = 0;
    for (const entry of allEntries) {
      if (!entry) continue;
      const v = entry[lang];
      if (!v || v.trim() === "") count++;
    }
    out[lang] = count;
  }
  return out;
}

/**
 * Count keys whose value for `lang` is missing or empty — exactly the
 * "missing" headline the Translations panel shows for the active language
 * (the empty-`target` rows of {@link buildTranslationRows}). Used by the
 * sidebar Translations tab badge so the nav count always matches the panel,
 * including when `lang` is the default (empty source strings count too).
 */
export function countMissingForLang(pack: Project, lang: string): number {
  let count = 0;
  for (const entry of Object.values(pack.i18nKeys)) {
    if (!entry) continue;
    const v = entry[lang];
    if (!v || v.trim() === "") count++;
  }
  return count;
}

/** Opaque template ids make unreadable contexts — show the SET's name:
 *  "item_templates.itpl_1_x.default.lore" → "set « Vue categories » · default.lore". */
function prettifyContext(pack: Project, path: string): string {
  const m = /^item_templates\.([^.]+)\.(.+)$/.exec(path);
  if (m) {
    const tpl = pack.itemTemplates?.find((t) => t.id === m[1]);
    if (tpl) return `set « ${tpl.name} » · ${m[2]}`;
  }
  return path;
}

export function buildTranslationRows(pack: Project, activeLang: string): TranslationRow[] {
  const usages = findKeyUsages(pack);
  const rows: TranslationRow[] = [];
  for (const [key, entry] of Object.entries(pack.i18nKeys)) {
    if (!entry) continue;
    rows.push({
      key: key as I18nKey,
      context: prettifyContext(pack, usages.get(key as I18nKey) ?? UNUSED_CONTEXT),
      source: entry[pack.defaultLang] ?? "",
      target: entry[activeLang] ?? "",
    });
  }
  // Sort by context so related strings sit together — much easier to skim and
  // to translate consistently (titles next to their lore, etc.). Orphaned
  // "(unused)" keys go last: otherwise "(" sorts before letters and stale
  // entries dominate the top of the list, reading as "everything is unused".
  rows.sort((a, b) => {
    const aUnused = a.context === UNUSED_CONTEXT;
    const bUnused = b.context === UNUSED_CONTEXT;
    if (aUnused !== bUnused) return aUnused ? 1 : -1;
    return a.context.localeCompare(b.context);
  });
  return rows;
}
