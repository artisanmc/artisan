import { getTitleTextLayers } from "@/domain/menuTitle";
import { walkActions } from "@/domain/stepPath";
import type { Appearance, Element, I18nKey, Menu, Pack } from "@/domain/types";
import { stateLabel } from "@/lib/i18nKeys";

/**
 * Walk a pack and label every LText reference with a dotted-path
 * "context" string describing where it sits in the tree. Used by the
 * Translations panel — both as inline metadata in the table and as
 * comments in the YAML copy output (so an AI / human translator knows
 * the register of each string).
 *
 * Path style mirrors the runtime YAML layout the plugin will consume:
 *   menus.<menuId>.title
 *   menus.<menuId>.elements.<elementId>.<state>.title
 *   menus.<menuId>.elements.<elementId>.<state>.lore[i]
 *   menus.<menuId>.elements.<elementId>.<state>.click.<type>.message
 *   commands.<commandId>.message
 *
 * `<state>` is "default" for index 0 and "stateN" otherwise — shorter
 * than the index-based form and matches how the editor labels
 * appearances in the UI.
 */
export function findKeyUsages(pack: Pack): Map<I18nKey, string> {
  const out = new Map<I18nKey, string>();

  const recordAppearance = (path: string, appearance: Appearance) => {
    if (appearance.title) out.set(appearance.title.key, `${path}.title`);
    if (appearance.lore) {
      out.set(appearance.lore.key, `${path}.lore`);
    }
    if (appearance.click) {
      for (const [clickType, handler] of Object.entries(appearance.click)) {
        if (!handler) continue;
        for (const action of walkActions(handler.steps)) {
          if (action.type === "send_message") {
            out.set(action.text.key, `${path}.click.${clickType}.message`);
          }
        }
      }
    }
  };

  const recordElement = (menuPath: string, el: Element) => {
    const elPath = `${menuPath}.elements.${el.id}`;
    el.appearances.forEach((a, i) => recordAppearance(`${elPath}.${stateLabel(i)}`, a));
  };

  const recordMenu = (menu: Menu) => {
    const menuPath = `menus.${menu.id}`;
    const titleLayers = getTitleTextLayers(menu);
    titleLayers.forEach((lt, i) => {
      const suffix = titleLayers.length > 1 ? `.title[${i}]` : `.title`;
      out.set(lt.key, `${menuPath}${suffix}`);
    });
    for (const layer of menu.layers) {
      for (const el of layer.elements) recordElement(menuPath, el);
    }
  };

  for (const m of pack.menus) recordMenu(m);
  for (const cmd of pack.commands) {
    const cmdPath = `commands.${cmd.id}`;
    for (const action of walkActions(cmd.steps)) {
      if (action.type === "send_message") out.set(action.text.key, `${cmdPath}.message`);
    }
  }
  for (const tpl of pack.templates) {
    const tplPath = `templates.${tpl.id}`;
    tpl.appearances.forEach((a, i) => recordAppearance(`${tplPath}.${stateLabel(i)}`, a));
  }

  return out;
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
export function listLanguages(pack: Pack): string[] {
  const langs = new Set<string>([pack.defaultLang]);
  for (const entry of Object.values(pack.i18nKeys)) {
    if (!entry) continue;
    for (const lang of Object.keys(entry)) langs.add(lang);
  }
  const others = Array.from(langs).filter((l) => l !== pack.defaultLang).sort();
  return [pack.defaultLang, ...others];
}

/**
 * For every non-default language in the pack, count how many keys lack
 * a translation (missing entirely or empty string). Used by the
 * Translations panel tab badges and by the top-bar Languages button
 * dot indicator. Default lang is intentionally excluded — its values
 * are the source, there's nothing to "miss".
 */
export function countMissingPerLang(pack: Pack): Record<string, number> {
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

export function totalMissing(pack: Pack): number {
  let sum = 0;
  for (const v of Object.values(countMissingPerLang(pack))) sum += v;
  return sum;
}

export function buildTranslationRows(pack: Pack, activeLang: string): TranslationRow[] {
  const usages = findKeyUsages(pack);
  const rows: TranslationRow[] = [];
  for (const [key, entry] of Object.entries(pack.i18nKeys)) {
    if (!entry) continue;
    rows.push({
      key: key as I18nKey,
      context: usages.get(key as I18nKey) ?? "(unused)",
      source: entry[pack.defaultLang] ?? "",
      target: entry[activeLang] ?? "",
    });
  }
  // Sort by context so related strings sit together — much easier to
  // skim and to translate consistently (titles next to their lore, etc.).
  rows.sort((a, b) => a.context.localeCompare(b.context));
  return rows;
}

