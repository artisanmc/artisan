import type { I18nKey, Project } from "@/domain/types";
import { type AiTranslateText, translateTexts } from "@/lib/api/ai";
import { isTranslationMissing, listLanguages } from "@/lib/i18nUsages";
import { useAiStatus } from "@/state/aiStatus";

/** The hub's limits on one call ({@link translateTexts}), with room to spare. */
const MAX_TEXTS = 100;
const MAX_TEXT = 4000;
const MAX_OUTPUT_CHARS = 20_000;

/** Translates one field's text into `langs`: what a {@link LocalizedField} asks for. */
export type FieldTranslate = (request: {
  label: string;
  source: string;
  sourceLang: string;
  langs: string[];
}) => Promise<Record<string, string>>;

/** A text with the languages it is missing. */
export interface MissingText extends AiTranslateText {
  langs: string[];
}

/**
 * Calls of at most the hub's limits, each to one set of target languages: texts missing the
 * same languages travel together. A text longer than a call allows is left out.
 */
export function batches(texts: MissingText[]): { targets: string[]; texts: AiTranslateText[] }[] {
  const byTargets = new Map<string, MissingText[]>();
  for (const text of texts) {
    if (text.text.length > MAX_TEXT || text.text.length * text.langs.length > MAX_OUTPUT_CHARS)
      continue;
    const key = [...text.langs].sort().join(",");
    byTargets.set(key, [...(byTargets.get(key) ?? []), text]);
  }
  const out: { targets: string[]; texts: AiTranslateText[] }[] = [];
  for (const [key, group] of byTargets) {
    const targets = key.split(",");
    let current: AiTranslateText[] = [];
    let chars = 0;
    for (const { langs: _, ...text } of group) {
      const size = text.text.length * targets.length;
      if (current.length && (current.length >= MAX_TEXTS || chars + size > MAX_OUTPUT_CHARS)) {
        out.push({ targets, texts: current });
        current = [];
        chars = 0;
      }
      current.push(text);
      chars += size;
    }
    if (current.length) out.push({ targets, texts: current });
  }
  return out;
}

/** The Project's texts missing a translation in `langs` (every other language when absent). */
export function missingTexts(
  project: Project,
  langs?: string[],
  context?: (key: I18nKey) => string | undefined,
): MissingText[] {
  const wanted = (langs ?? listLanguages(project)).filter((l) => l !== project.defaultLang);
  const out: MissingText[] = [];
  for (const [key, entry] of Object.entries(project.i18nKeys)) {
    if (!entry) continue;
    const source = entry[project.defaultLang];
    const missing = wanted.filter((lang) =>
      isTranslationMissing(project.defaultLang, lang, source, entry[lang]),
    );
    if (!missing.length || !source) continue;
    const where = context?.(key as I18nKey);
    out.push({ id: key, text: source, langs: missing, ...(where ? { context: where } : {}) });
  }
  return out;
}

export interface TranslateOutcome {
  /** Translations written. */
  written: number;
  /** Texts with a language still missing (left out by the model, a placeholder lost, too long). */
  failed: number;
}

/**
 * Fills the missing languages of `texts` (from `sourceLang`), call after call, writing each
 * translation through `write` as it comes. The first call that fails rejects with its error;
 * what was written before stays.
 */
export async function translateMissing(
  texts: MissingText[],
  sourceLang: string,
  write: (id: string, lang: string, value: string) => void,
  options: { module?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<TranslateOutcome> {
  const calls = batches(texts);
  const sent = calls.reduce((n, c) => n + c.texts.length, 0);
  let written = 0;
  let failed = texts.length - sent;
  let done = 0;
  options.onProgress?.(0, sent);
  for (const call of calls) {
    const result = await translateTexts({
      source: sourceLang,
      targets: call.targets,
      texts: call.texts,
      ...(options.module ? { module: options.module } : {}),
    });
    for (const [id, byLang] of Object.entries(result.translations)) {
      for (const [lang, value] of Object.entries(byLang)) {
        write(id, lang, value);
        written++;
      }
    }
    failed += result.failed.length;
    done += call.texts.length;
    options.onProgress?.(done, sent);
  }
  return { written, failed };
}

/**
 * The field's "Translate the missing ones" when the hub has an assistant this player may use;
 * undefined otherwise (the button does not show).
 */
export function useFieldTranslate(module?: string): FieldTranslate | undefined {
  const status = useAiStatus();
  if (!status?.canUse) return undefined;
  return async ({ label, source, sourceLang, langs }) => {
    const result = await translateTexts({
      source: sourceLang,
      targets: langs,
      texts: [{ id: "field", text: source, context: label }],
      ...(module ? { module } : {}),
    });
    return result.translations.field ?? {};
  };
}
