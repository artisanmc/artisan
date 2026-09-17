import { visitProjectLTexts } from "@/domain/i18nSites";
import type { I18nKey, Project } from "@/domain/types";
import { isTranslationMissing, listLanguages } from "@/lib/i18nUsages";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validate(project: Project): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Collect all LText keys referenced in the project — one traversal covering
  // menus, commands, templates, and dialogs (see @/domain/i18nSites).
  const referencedKeys = new Set<string>();
  for (const site of visitProjectLTexts(project)) referencedKeys.add(site.lText.key);

  // 1. Every referenced key must have a value entry in defaultLang. An
  // explicit empty string is valid: it means this text is intentionally blank.
  for (const key of referencedKeys) {
    const entry = project.i18nKeys[key as I18nKey];
    if (!entry) {
      errors.push(`Key "${key}" is referenced but has no translations (missing entirely).`);
      continue;
    }
    const val = entry[project.defaultLang];
    if (val === undefined) {
      errors.push(`Key "${key}" has no ${project.defaultLang} (default language) value.`);
    }
  }

  // 2. No stale undefined entry in i18nKeys
  for (const [key, entry] of Object.entries(project.i18nKeys)) {
    if (!entry) {
      errors.push(`Key "${key}" has an undefined entry — stale migration artifact.`);
    }
  }

  // 3. Warn on non-default languages with missing translations
  const langs = listLanguages(project).filter((l) => l !== project.defaultLang);
  for (const lang of langs) {
    let missingCount = 0;
    for (const key of referencedKeys) {
      const entry = project.i18nKeys[key as I18nKey];
      if (
        isTranslationMissing(project.defaultLang, lang, entry?.[project.defaultLang], entry?.[lang])
      ) {
        missingCount++;
      }
    }
    if (missingCount > 0) {
      warnings.push(`${missingCount} key(s) missing translation for language "${lang}".`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
