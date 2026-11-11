// Domain → `lang/<code>.yaml` entries. Since ADR `field-local-translations` and
// `structured-action-wire`, document text lives in the documents: `lang/` only
// holds siteless presentation keys and data-source addresses.
import { visitProjectLTexts } from "@/domain/i18nSites";
import type { Project } from "@/domain/types";
import { DURATION_DEFAULTS, DURATION_KEYS } from "@/lib/expr/duration";

/**
 * Keys that belong to the **project**, not to any document site: presentation
 * settings an admin may want to override (the `until()` duration units).
 *
 * They are why inline mode still emits a default-language lang file. The "no
 * default lang file in inline mode" rule exists because a site-addressed key
 * would be a second copy of text that already lives in its document — a siteless
 * key has no document to live in, so the lang file is its only home.
 */
const SITELESS_KEYS: string[] = Object.values(DURATION_KEYS);

/** The default each presentation key is written out with, keyed by the key itself. */
const DURATION_DEFAULTS_BY_KEY: Record<string, string> = Object.fromEntries(
  (Object.keys(DURATION_KEYS) as Array<keyof typeof DURATION_KEYS>).map((name) => [
    DURATION_KEYS[name],
    DURATION_DEFAULTS[name],
  ]),
);

/** Keys that still live in `lang/`: **siteless** presentation keys only. All
 *  document text (structural AND action, since ADR `structured-action-wire`) is
 *  field-local, inline in the document. Data-source ltext is handled by
 *  `dataSourceI18n` (ADR `bare-data-files` ④). */
export function collectReferencedKeys(_project: Project): Set<string> {
  return new Set<string>(SITELESS_KEYS);
}

/** The flat `key → text` entries of one language's file, byte-order sorted. */
export function serializeLang(
  project: Project,
  lang: string,
  referencedKeys: Set<string>,
  // Data-source entries, already re-addressed to canonical key sites (ADR
  // bare-data-files ④) — empty for the default language (inlined in data/).
  dataEntries: Record<string, string> = {},
): Record<string, string> {
  const i18nKeys: Readonly<Record<string, Record<string, string> | undefined>> = project.i18nKeys;
  const entries: Array<[string, string]> = [];
  // Iterate `referencedKeys` (not `project.i18nKeys`) so we always emit *every*
  // key the runtime will look up — even ones that have never been assigned a
  // value. Otherwise a freshly-created menu with no title typed yet yields a
  // missing key in the YAML, and the plugin falls back to printing the raw
  // key (`menus.foo.title`) to chat instead of nothing.
  for (const key of referencedKeys) {
    const val = i18nKeys[key]?.[lang];
    const presentationDefault = DURATION_DEFAULTS_BY_KEY[key];
    if (val !== undefined) {
      entries.push([key, val]);
    } else if (presentationDefault !== undefined) {
      // A presentation key seeds its actual default, not "": the point of writing
      // it out is that an admin opening lang/ sees what it does and can change it.
      entries.push([key, presentationDefault]);
    } else if (lang === project.defaultLang) {
      // Always seed the defaultLang file with an empty string so the runtime
      // resolves the key to "" rather than echoing the raw key.
      entries.push([key, ""]);
    }
  }
  for (const [k, v] of Object.entries(dataEntries)) {
    if (!referencedKeys.has(k)) entries.push([k, v]);
  }
  // Byte-order sort: lang files must be deterministic regardless of key
  // collection order (files-first fixed point — import then re-export may
  // visit documents in a different order).
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out: Record<string, string> = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/**
 * One language's entries for the keys kept as read (`Project.keptLangKeys`), from
 * their current value: those removed from `i18nKeys` are gone, and a key a site
 * owns by now (a module's kind, a model arrived after the import) is left to it.
 */
export function keptLangEntries(project: Project, lang: string): Record<string, string> {
  const kept = project.keptLangKeys ?? [];
  if (kept.length === 0) return {};
  const owned = new Set<string>();
  for (const site of visitProjectLTexts(project)) {
    owned.add(site.key);
    owned.add(site.lText.key);
  }
  const out: Record<string, string> = {};
  for (const key of kept) {
    const value = project.i18nKeys[key as keyof Project["i18nKeys"]]?.[lang];
    if (value !== undefined && !owned.has(key)) out[key] = value;
  }
  return out;
}
