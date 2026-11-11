import type { I18nKey, Project } from "@/domain/types";
import type { ActionTextCodec } from "@/lib/actions/structuredSteps";

/**
 * A structural site's text as it lands on disk (ADR `field-local-translations`):
 * a bare string when only the default language has a value (sugar for
 * `{<defaultLang>: text}`), otherwise a `{ lang: text }` map. The site's key is
 * canonicalized by `rekeyProject` just before export, so `project.i18nKeys[key]`
 * holds exactly this site's per-language values.
 *
 * Action texts use the same shape (ADR `structured-action-wire`) : the wire step
 * text is a {@link FieldText} produced by this same serializer.
 */
export type FieldText = string | Record<string, string>;
export type FieldTextOf = (key: I18nKey) => FieldText;

/** The writer of every text site of a document, shared by the per-kind writers. */
export function fieldTextOf(project: Project): FieldTextOf {
  return (key) => {
    const entry = project.i18nKeys[key] ?? {};
    const langs = Object.keys(entry);
    // A bare string means the default language: a lone other language keeps its map.
    if (langs.length === 0 || (langs.length === 1 && langs[0] === project.defaultLang))
      return entry[project.defaultLang] ?? "";
    const out: Record<string, string> = {};
    for (const lang of langs) out[lang] = entry[lang] ?? "";
    return out;
  };
}

/**
 * A lore on disk (ADR `field-local-translations` §1): a list of lines when only
 * the default language has a value, otherwise one list per language, so each
 * language keeps its own line count. A whole `{i18n:key}` ref stays one line.
 */
export function loreWire(text: FieldText): string[] | Record<string, string[]> {
  if (typeof text === "string") return /^\{i18n:[^}]+\}$/.test(text) ? [text] : text.split("\n");
  return Object.fromEntries(Object.entries(text).map(([lang, value]) => [lang, value.split("\n")]));
}

/** Codec for the structured action wire: only `toWire` is used on export. */
export function actionTextCodec(project: Project): ActionTextCodec {
  return { toWire: fieldTextOf(project), fromWire: () => ({ key: "" as I18nKey }) };
}
