import type { I18nKey, LText, Project } from "@/domain/types";

/**
 * Generate an opaque i18n key. Random base36 — the user never sees this,
 * so we don't bother with anything human-readable. Collisions are
 * astronomically unlikely within a single project but the helper is meant
 * to be called inside an immer producer where we hold a draft, so even
 * if two `createLText` calls landed on the same key in the same tick
 * (impossible with `Math.random` but) the second would overwrite the
 * first. Acceptable.
 */
export const newI18nKey = (): I18nKey =>
  `lt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}` as I18nKey;

/**
 * Read a localized string from a project. Falls back along
 *   activeLang → project.defaultLang → "" .
 *
 * Pure read — safe to call outside an immer producer. Returns "" for
 * undefined `lt` so render code can treat empty fields uniformly.
 */
export function getText(project: Project, lt: LText | undefined, activeLang: string): string {
  if (!lt) return "";
  const entry = project.i18nKeys[lt.key];
  if (!entry) return "";
  const v = entry[activeLang];
  if (v !== undefined) return v;
  return entry[project.defaultLang] ?? "";
}

/**
 * Mutate `project.i18nKeys[lt.key][lang]` to `value`. Caller must hold an
 * immer draft (this writes through the proxy). No-op if `value` is the
 * same as the current entry.
 */
export function setLText(project: Project, lt: LText, lang: string, value: string): void {
  let entry = project.i18nKeys[lt.key];
  if (!entry) {
    entry = {};
    project.i18nKeys[lt.key] = entry;
  }
  entry[lang] = value;
}

/**
 * Allocate a fresh i18n key, seed it with `initialValue` in `lang`, and
 * return an `LText` ref the caller can plug into the domain field.
 * Caller must hold an immer draft.
 */
export function createLText(project: Project, initialValue: string, lang: string): LText {
  const key = newI18nKey();
  project.i18nKeys[key] = { [lang]: initialValue };
  return { key };
}

/**
 * Like `createLText` but uses an explicit semantic key instead of a random
 * one. If the key already exists in the project, the existing entry is kept
 * (idempotent). Caller must hold an immer draft.
 */
export function createLTextAt(
  project: Project,
  key: I18nKey,
  initialValue: string,
  lang: string,
): LText {
  if (!project.i18nKeys[key]) {
    project.i18nKeys[key] = { [lang]: initialValue };
  }
  return { key };
}

/**
 * Drop the entry from `project.i18nKeys`. Call when the parent field
 * (menu/appearance/lore line/action) is being deleted — leaving entries
 * around isn't fatal (they just take space) but a leak in the editor's
 * source of truth is awkward.
 */
export function deleteLText(project: Project, lt: LText | undefined): void {
  if (!lt) return;
  delete project.i18nKeys[lt.key];
}

/**
 * GC every key referenced by the given LText array (e.g. an entire
 * `appearance.lore` array, or all titles/lores in a deleted appearance).
 */
