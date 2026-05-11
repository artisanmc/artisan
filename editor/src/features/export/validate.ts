import { getTitleTextLayers } from "@/domain/menuTitle";
import { walkActions } from "@/domain/stepPath";
import type { I18nKey, Pack } from "@/domain/types";
import { listLanguages } from "@/lib/i18nUsages";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validate(pack: Pack): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Collect all LText keys referenced in the pack
  const referencedKeys = new Set<string>();
  for (const menu of pack.menus) {
    for (const lt of getTitleTextLayers(menu)) referencedKeys.add(lt.key);
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        for (const app of el.appearances) {
          if (app.title) referencedKeys.add(app.title.key);
          if (app.lore) referencedKeys.add(app.lore.key);
          if (app.click) {
            for (const handler of Object.values(app.click)) {
              if (!handler) continue;
              for (const action of walkActions(handler.steps)) {
                if (action.type === "send_message") referencedKeys.add(action.text.key);
              }
            }
          }
        }
      }
    }
  }
  for (const cmd of pack.commands) {
    for (const action of walkActions(cmd.steps)) {
      if (action.type === "send_message") referencedKeys.add(action.text.key);
    }
  }

  // 1. Every referenced key must have a non-empty value in defaultLang
  for (const key of referencedKeys) {
    const entry = pack.i18nKeys[key as I18nKey];
    if (!entry) {
      errors.push(`Key "${key}" is referenced but has no translations (missing entirely).`);
      continue;
    }
    const val = entry[pack.defaultLang];
    if (!val || val.trim() === "") {
      errors.push(`Key "${key}" has no ${pack.defaultLang} (default language) value.`);
    }
  }

  // 2. No stale undefined entry in i18nKeys
  for (const [key, entry] of Object.entries(pack.i18nKeys)) {
    if (!entry) {
      errors.push(`Key "${key}" has an undefined entry — stale migration artifact.`);
    }
  }

  // 3. Warn on non-default languages with missing translations
  const langs = listLanguages(pack).filter((l) => l !== pack.defaultLang);
  for (const lang of langs) {
    let missingCount = 0;
    for (const key of referencedKeys) {
      const entry = pack.i18nKeys[key as I18nKey];
      const val = entry?.[lang];
      if (!val || val.trim() === "") missingCount++;
    }
    if (missingCount > 0) {
      warnings.push(`${missingCount} key(s) missing translation for language "${lang}".`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
