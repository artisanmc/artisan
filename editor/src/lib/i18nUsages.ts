import { visitProjectLTexts } from "@/domain/i18nSites";
import type { I18nKey, Project } from "@/domain/types";

/**
 * Label every LText reference in a project with a dotted-path "context" string
 * describing where it sits in the tree. Used by the Translations panel — both
 * as inline metadata in the table and as comments in the YAML copy output (so
 * an AI / human translator knows the register of each string).
 *
 * Thin fold over the single project traversal in `@/domain/i18nSites`; the path
 * vocabulary (`menus.<id>.title`, `…click.<type>.message`, `…body[i]`) lives
 * there as each site's `path`.
 */
export function findKeyUsages(project: Project): Map<I18nKey, string> {
  const out = new Map<I18nKey, string>();
  for (const site of visitProjectLTexts(project)) out.set(site.lText.key, site.path);
  return out;
}

const UNUSED_CONTEXT = "(unused)";

/**
 * All i18n keys present in the project's translation map that no longer have a
 * reference anywhere in the tree (menus, commands, templates, dialogs). These
 * are stale leftovers from deleted elements / re-imports — safe to drop. Used
 * by the Translations panel's "remove unused" cleanup.
 */
export function findUnusedI18nKeys(project: Project): I18nKey[] {
  const used = findKeyUsages(project);
  return (Object.keys(project.i18nKeys) as I18nKey[]).filter((key) => !used.has(key));
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
 * Enumerate all languages present in a project's i18n map, including the
 * default. Result is stable-ordered: defaultLang first, then the rest
 * alphabetically. A project with zero translations still returns
 * `[defaultLang]` so the UI can still render the source-edit tab.
 */
export function listLanguages(project: Project): string[] {
  const langs = new Set<string>([project.defaultLang]);
  for (const entry of Object.values(project.i18nKeys)) {
    if (!entry) continue;
    for (const lang of Object.keys(entry)) langs.add(lang);
  }
  const others = Array.from(langs)
    .filter((l) => l !== project.defaultLang)
    .sort();
  return [project.defaultLang, ...others];
}

/** The persisted active language, or the project's default when it no longer exists there. */
export function validActiveLang(project: Project, activeLang: string): string {
  return listLanguages(project).includes(activeLang) ? activeLang : project.defaultLang;
}

/**
 * A translation is missing only when the source has content and a secondary
 * language has no content. An explicitly empty source is a valid intentional
 * blank (for example an item title or lore that should not render).
 */
export function isTranslationMissing(
  defaultLang: string,
  lang: string,
  source: string | undefined,
  target: string | undefined,
): boolean {
  return lang !== defaultLang && Boolean(source?.trim()) && !target?.trim();
}

/**
 * For every non-default language in the project, count how many keys lack
 * a translation for a non-empty source (missing entirely or empty string).
 * Used by the Translations panel tab badges and by the top-bar Languages button
 * dot indicator. Default lang is intentionally excluded, and empty source
 * values are treated as intentional blanks rather than missing translations.
 */
export function countMissingPerLang(project: Project): Record<string, number> {
  const out: Record<string, number> = {};
  const allEntries = Object.values(project.i18nKeys);
  for (const lang of listLanguages(project)) {
    if (lang === project.defaultLang) continue;
    let count = 0;
    for (const entry of allEntries) {
      if (!entry) continue;
      if (
        isTranslationMissing(project.defaultLang, lang, entry[project.defaultLang], entry[lang])
      ) {
        count++;
      }
    }
    out[lang] = count;
  }
  return out;
}

/**
 * Count keys whose target value is missing while the default-language source
 * contains text. Used by the sidebar Translations tab badge so the nav count
 * always matches the panel. Explicitly blank source values are not missing,
 * including when `lang` is the default language.
 */
export function countMissingForLang(project: Project, lang: string): number {
  let count = 0;
  for (const entry of Object.values(project.i18nKeys)) {
    if (!entry) continue;
    if (isTranslationMissing(project.defaultLang, lang, entry[project.defaultLang], entry[lang])) {
      count++;
    }
  }
  return count;
}

export function buildTranslationRows(project: Project, activeLang: string): TranslationRow[] {
  const usages = findKeyUsages(project);
  const rows: TranslationRow[] = [];
  for (const [key, entry] of Object.entries(project.i18nKeys)) {
    if (!entry) continue;
    rows.push({
      key: key as I18nKey,
      context: usages.get(key as I18nKey) ?? UNUSED_CONTEXT,
      source: entry[project.defaultLang] ?? "",
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
