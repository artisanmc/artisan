/**
 * Artisan — Translations schema v1 — TypeScript types
 *
 * Source of truth for a workspace's translations.
 * Maintained by hand, mirroring schema.json.
 *
 * Model:
 *   - One key = one translatable text, scoped to the workspace.
 *   - The content of each value is MiniMessage.
 *   - Referenced from menus/commands via the inline syntax {i18n:<key>}.
 *
 * Resolution order on the plugin side (when a menu opens / a command runs):
 *   1. {i18n:key}        → value stored for the player's active language (fallback default_lang)
 *   2. %papi_placeholder% → resolved via PlaceholderAPI
 *   3. parse MiniMessage → final Adventure Component sent to the player
 *
 * So a translation CAN contain placeholders and MiniMessage tags.
 */

// ============================================================================
// TOP-LEVEL
// ============================================================================

export interface Translations {
  schema: "translations/v1";
  default_lang: LangCode;
  languages: LangCode[];
  keys: Record<TranslationKey, KeyTranslations>;
  metadata?: TranslationsMetadata;
}

/**
 * Language code, BCP-47-light style:
 *   - "fr", "en", "de", "es", "ja", "fil"
 *   - "en_US", "en_GB", "pt_BR", "zh_CN" (lang lowercase, region any case)
 */
export type LangCode = string;

/**
 * Translation key. Hierarchical slug with '.':
 *   - "menu.shop_main.title"
 *   - "menu.shop_main.btn_buy.lore.0"
 *   - "command.profile.description"
 *   - "common.errors.no_perm"
 */
export type TranslationKey = string;

/**
 * Map language → MiniMessage value. Must contain at least default_lang.
 * A language listed in Translations.languages but absent here → runtime fallback to default_lang.
 */
export type KeyTranslations = Record<LangCode, string>;

export interface TranslationsMetadata {
  created_at?: string;
  updated_at?: string;
  key_count?: number;
  [key: string]: unknown;
}

// ============================================================================
// REGEX & CONSTANTS
// ============================================================================

/** Validation regex for a translation key. */
export const TRANSLATION_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/** Validation regex for a language code. */
export const LANG_CODE_RE = /^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/;

/**
 * Regex to extract {i18n:key} references from a MiniMessage string.
 * Match group 1 = the key.
 */
export const I18N_REF_RE = /\{i18n:([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\}/g;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export interface TranslationsCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Checks the translations file's consistency beyond the JSON Schema:
 *   - default_lang is in languages[]
 *   - each key has at least the default_lang
 *   - no value is empty
 *   - flags languages declared but never used (warning)
 */
export function validateTranslations(t: Translations): TranslationsCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!t.languages.includes(t.default_lang)) {
    errors.push(`default_lang "${t.default_lang}" is not in languages[].`);
  }

  const langUsage = new Map<LangCode, number>();
  for (const lang of t.languages) langUsage.set(lang, 0);

  for (const [key, perLang] of Object.entries(t.keys)) {
    if (!TRANSLATION_KEY_RE.test(key)) {
      errors.push(`Key "${key}" does not follow the hierarchical slug format.`);
      continue;
    }
    if (!(t.default_lang in perLang)) {
      errors.push(`Key "${key}" has no value for the default_lang "${t.default_lang}".`);
    }
    for (const [lang, value] of Object.entries(perLang)) {
      if (!t.languages.includes(lang)) {
        warnings.push(`Key "${key}" has a value for "${lang}" which is not in languages[]. It will be ignored.`);
        continue;
      }
      if (value.trim().length === 0) {
        warnings.push(`Key "${key}" has an empty value for "${lang}".`);
      }
      langUsage.set(lang, (langUsage.get(lang) ?? 0) + 1);
    }
  }

  for (const [lang, count] of langUsage) {
    if (count === 0 && lang !== t.default_lang) {
      warnings.push(`Language "${lang}" is declared but no key has a value — remove it or fill it in.`);
    }
  }

  return { errors, warnings };
}

/**
 * Lists the keys missing for a given language compared to the default_lang.
 * Useful to show the progress bar "FR: 100%, EN: 73%" in the UI.
 */
export function missingTranslations(t: Translations, lang: LangCode): TranslationKey[] {
  const missing: TranslationKey[] = [];
  for (const [key, perLang] of Object.entries(t.keys)) {
    if (!(lang in perLang) || perLang[lang].trim().length === 0) {
      missing.push(key);
    }
  }
  return missing;
}

/**
 * Computes a language's completion percentage (vs default_lang).
 */
export function completionPercent(t: Translations, lang: LangCode): number {
  const total = Object.keys(t.keys).length;
  if (total === 0) return 100;
  return Math.round(((total - missingTranslations(t, lang).length) / total) * 100);
}

// ============================================================================
// I18N REF EXTRACTION
// ============================================================================

/**
 * Extracts all {i18n:key} references from a MiniMessage string.
 * Returns a deduplicated list of the referenced keys.
 */
export function extractI18nRefs(text: string): TranslationKey[] {
  const refs = new Set<TranslationKey>();
  for (const m of text.matchAll(I18N_REF_RE)) {
    refs.add(m[1]);
  }
  return Array.from(refs);
}

/**
 * Extracts all i18n keys referenced by an object (recursive).
 * Useful to compute the translations to embed in an .itfz at export.
 */
export function extractI18nRefsDeep(obj: unknown): TranslationKey[] {
  const refs = new Set<TranslationKey>();
  walk(obj, refs);
  return Array.from(refs);
}

function walk(obj: unknown, refs: Set<TranslationKey>): void {
  if (typeof obj === "string") {
    for (const m of obj.matchAll(I18N_REF_RE)) refs.add(m[1]);
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) walk(item, refs);
    return;
  }
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) walk(v, refs);
  }
}

// ============================================================================
// AUTO-KEY GENERATION
// ============================================================================

/**
 * Generates a candidate key from an editing context.
 * Examples:
 *   generateAutoKey({ kind: "menu_title",   menu_id: "shop_main" })
 *     → "menu.shop_main.title"
 *   generateAutoKey({ kind: "element_lore", menu_id: "shop_main", element_id: "btn_buy", lore_index: 1 })
 *     → "menu.shop_main.btn_buy.lore.1"
 *   generateAutoKey({ kind: "command_description", command_id: "profile" })
 *     → "command.profile.description"
 *
 * If the key already exists, the editor must call generateUniqueKey to suffix _2, _3...
 */
export type AutoKeyContext =
  | { kind: "menu_title"; menu_id: string }
  | { kind: "menu_background_lore"; menu_id: string; lore_index: number }
  | { kind: "element_title"; menu_id: string; element_id: string }
  | { kind: "element_lore"; menu_id: string; element_id: string; lore_index: number }
  | { kind: "send_message"; menu_id: string; element_id?: string }
  | { kind: "broadcast"; menu_id: string; element_id?: string }
  | { kind: "cooldown_message"; cooldown_id: string }
  | { kind: "command_description"; command_id: string }
  | { kind: "command_send_message"; command_id: string; index: number }
  | { kind: "custom"; segments: string[] };

export function generateAutoKey(ctx: AutoKeyContext): TranslationKey {
  switch (ctx.kind) {
    case "menu_title":             return `menu.${ctx.menu_id}.title`;
    case "menu_background_lore":   return `menu.${ctx.menu_id}.background.lore.${ctx.lore_index}`;
    case "element_title":          return `menu.${ctx.menu_id}.${ctx.element_id}.title`;
    case "element_lore":           return `menu.${ctx.menu_id}.${ctx.element_id}.lore.${ctx.lore_index}`;
    case "send_message":           return ctx.element_id ? `menu.${ctx.menu_id}.${ctx.element_id}.message` : `menu.${ctx.menu_id}.message`;
    case "broadcast":              return ctx.element_id ? `menu.${ctx.menu_id}.${ctx.element_id}.broadcast` : `menu.${ctx.menu_id}.broadcast`;
    case "cooldown_message":       return `cooldown.${ctx.cooldown_id}.message`;
    case "command_description":    return `command.${ctx.command_id}.description`;
    case "command_send_message":   return `command.${ctx.command_id}.message.${ctx.index}`;
    case "custom":                 return ctx.segments.join(".");
  }
}

/**
 * Suffixes the key with _2, _3, ... until an unused key is found.
 */
export function generateUniqueKey(base: TranslationKey, existing: ReadonlySet<TranslationKey>): TranslationKey {
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Cannot generate unique key from "${base}"`);
}
