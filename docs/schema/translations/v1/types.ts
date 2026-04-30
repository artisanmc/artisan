/**
 * Interfaze — Translations schema v1 — TypeScript types
 *
 * Source de vérité pour les traductions d'un workspace.
 * Maintenu à la main, en miroir de schema.json.
 *
 * Modèle :
 *   - Une clé = un texte traduisible, scoped au workspace.
 *   - Le contenu de chaque valeur est du MiniMessage.
 *   - Référencée depuis menus/commandes via la syntaxe inline {i18n:<key>}.
 *
 * Ordre de résolution côté plugin (à l'opening d'un menu / l'exécution d'une commande) :
 *   1. {i18n:key}        → valeur stockée pour la langue active du joueur (fallback default_lang)
 *   2. %papi_placeholder% → résolu via PlaceholderAPI
 *   3. parse MiniMessage → Component Adventure final envoyé au joueur
 *
 * Donc une traduction PEUT contenir des placeholders et des tags MiniMessage.
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
 * Code de langue style BCP-47-light :
 *   - "fr", "en", "de", "es", "ja", "fil"
 *   - "en_US", "en_GB", "pt_BR", "zh_CN" (lang lowercase, region any case)
 */
export type LangCode = string;

/**
 * Clé de traduction. Slug hiérarchique avec '.' :
 *   - "menu.shop_main.title"
 *   - "menu.shop_main.btn_buy.lore.0"
 *   - "command.profile.description"
 *   - "common.errors.no_perm"
 */
export type TranslationKey = string;

/**
 * Map langue → valeur MiniMessage. Doit contenir au moins default_lang.
 * Une langue listée dans Translations.languages mais absente ici → fallback runtime à default_lang.
 */
export type KeyTranslations = Record<LangCode, string>;

export interface TranslationsMetadata {
  created_at?: string;
  updated_at?: string;
  key_count?: number;
  [key: string]: unknown;
}

// ============================================================================
// REGEX & CONSTANTES
// ============================================================================

/** Regex de validation d'une clé de traduction. */
export const TRANSLATION_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/** Regex de validation d'un code de langue. */
export const LANG_CODE_RE = /^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/;

/**
 * Regex pour extraire les références {i18n:key} d'une string MiniMessage.
 * Match groupe 1 = la clé.
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
 * Vérifie cohérence du fichier translations au-delà du JSON Schema :
 *   - default_lang est bien dans languages[]
 *   - chaque clé a au minimum la default_lang
 *   - aucune valeur n'est vide
 *   - flag les langues déclarées mais jamais utilisées (warning)
 */
export function validateTranslations(t: Translations): TranslationsCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!t.languages.includes(t.default_lang)) {
    errors.push(`default_lang "${t.default_lang}" n'est pas dans languages[].`);
  }

  const langUsage = new Map<LangCode, number>();
  for (const lang of t.languages) langUsage.set(lang, 0);

  for (const [key, perLang] of Object.entries(t.keys)) {
    if (!TRANSLATION_KEY_RE.test(key)) {
      errors.push(`Clé "${key}" ne respecte pas le format slug hiérarchique.`);
      continue;
    }
    if (!(t.default_lang in perLang)) {
      errors.push(`Clé "${key}" n'a pas de valeur pour la default_lang "${t.default_lang}".`);
    }
    for (const [lang, value] of Object.entries(perLang)) {
      if (!t.languages.includes(lang)) {
        warnings.push(`Clé "${key}" a une valeur pour "${lang}" qui n'est pas dans languages[]. Sera ignorée.`);
        continue;
      }
      if (value.trim().length === 0) {
        warnings.push(`Clé "${key}" a une valeur vide pour "${lang}".`);
      }
      langUsage.set(lang, (langUsage.get(lang) ?? 0) + 1);
    }
  }

  for (const [lang, count] of langUsage) {
    if (count === 0 && lang !== t.default_lang) {
      warnings.push(`Langue "${lang}" déclarée mais aucune clé n'a de valeur — supprime ou complète.`);
    }
  }

  return { errors, warnings };
}

/**
 * Liste les clés manquantes pour une langue donnée par rapport à la default_lang.
 * Utile pour afficher la barre de progression "FR: 100%, EN: 73%" dans l'UI.
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
 * Calcule le pourcentage de complétion d'une langue (vs default_lang).
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
 * Extrait toutes les références {i18n:key} d'une string MiniMessage.
 * Renvoie une liste dédupliquée des clés référencées.
 */
export function extractI18nRefs(text: string): TranslationKey[] {
  const refs = new Set<TranslationKey>();
  for (const m of text.matchAll(I18N_REF_RE)) {
    refs.add(m[1]);
  }
  return Array.from(refs);
}

/**
 * Extrait toutes les clés i18n référencées par un objet (récursif).
 * Utile pour calculer les translations à embarquer dans un .itfz à l'export.
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
 * Génère une clé candidate à partir d'un contexte d'édition.
 * Exemples :
 *   generateAutoKey({ kind: "menu_title",   menu_id: "shop_main" })
 *     → "menu.shop_main.title"
 *   generateAutoKey({ kind: "element_lore", menu_id: "shop_main", element_id: "btn_buy", lore_index: 1 })
 *     → "menu.shop_main.btn_buy.lore.1"
 *   generateAutoKey({ kind: "command_description", command_id: "profile" })
 *     → "command.profile.description"
 *
 * Si la clé existe déjà, l'éditeur doit appeler generateUniqueKey pour suffixer _2, _3...
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
 * Suffixe la clé _2, _3, ... jusqu'à trouver une clé non utilisée.
 */
export function generateUniqueKey(base: TranslationKey, existing: ReadonlySet<TranslationKey>): TranslationKey {
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Cannot generate unique key from "${base}"`);
}
