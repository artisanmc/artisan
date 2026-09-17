import { deleteLText } from "@/lib/i18n";
import { addressedAppearances } from "./element";
import type { Appearance, LText, Project } from "./types";

/** Placeholder rendant le lore de l'item de base, à l'endroit où il est écrit. */
export const BASE_LORE_TOKEN = "{base.lore}";

/**
 * Retire le `{base.lore}` de tête devenu inutile.
 *
 * Tant qu'un lore explicite écrasait celui de l'item de base, conserver ce
 * dernier imposait d'écrire le placeholder — l'éditeur et la migration du
 * catalogue Boutique l'inséraient donc d'office, y compris là où l'auteur n'en
 * avait jamais rien demandé. Le lore de base étant désormais conservé par
 * défaut, « `lore_mode: replace` + `{base.lore}` en première ligne » dit
 * exactement ce que dit le défaut : on le réécrit sous sa forme nue.
 *
 * Strictement équivalent au rendu ; un token ailleurs qu'en tête positionne
 * réellement le lore de base et n'est pas touché.
 */
export function normalizeBaseLore(project: Project): void {
  for (const menu of project.menus ?? [])
    for (const layer of menu.layers)
      for (const element of layer.elements)
        for (const appearance of addressedAppearances(element))
          normalizeAppearance(project, appearance);
  for (const source of project.dataSources ?? [])
    normalizeItemValues(project, source.shape === "table" ? source.rows : source.value);
}

function normalizeAppearance(project: Project, appearance: Appearance): void {
  if (appearance.loreMode !== "replace" || !appearance.lore) return;
  const values = project.i18nKeys[appearance.lore.key];
  const entries = Object.entries(values ?? {});
  if (entries.length === 0 || !entries.every(([, text]) => leads(text))) return;
  appearance.loreMode = undefined;
  if (entries.every(([, text]) => strip(text) === "")) {
    deleteLText(project, appearance.lore);
    appearance.lore = undefined;
    return;
  }
  for (const [lang, text] of entries) values![lang] = strip(text);
}

/**
 * Les valeurs d'item vivent au fond des lignes de source : descente récursive.
 *
 * Une ligne de lore y est un littéral OU un nœud `LText` — c'est la forme qui
 * sort de l'import, chaque ligne portant sa propre adresse. Les deux comptent :
 * ne lire que les littéraux laissait les catalogues réels intacts.
 */
function normalizeItemValues(project: Project, value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) normalizeItemValues(project, entry);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.lore_mode === "replace" && record.lore !== undefined) {
    const lines = Array.isArray(record.lore) ? [...record.lore] : [record.lore];
    if (stripHead(project, lines)) {
      Reflect.deleteProperty(record, "lore_mode");
      if (lines.length === 0) Reflect.deleteProperty(record, "lore");
      else record.lore = lines;
    }
  }
  for (const entry of Object.values(record)) normalizeItemValues(project, entry);
}

/**
 * Retire le token de tête de `lines` (muté) et dit si quelque chose a bougé.
 * Vidée de son token, une ligne disparaît — avec ses traductions, l'adresse de
 * chaque ligne étant redérivée de sa position à l'écriture.
 */
function stripHead(project: Project, lines: unknown[]): boolean {
  const head = lines[0];
  if (typeof head === "string") {
    if (!leads(head)) return false;
    const rest = strip(head);
    if (rest === "") lines.shift();
    else lines[0] = rest;
    return true;
  }
  if (!head || typeof head !== "object" || !("key" in head)) return false;
  const lText = head as LText;
  const values = project.i18nKeys[lText.key];
  const entries = Object.entries(values ?? {});
  if (entries.length === 0 || !entries.every(([, text]) => leads(text))) return false;
  if (entries.every(([, text]) => strip(text) === "")) {
    deleteLText(project, lText);
    lines.shift();
    return true;
  }
  for (const [lang, text] of entries) values![lang] = strip(text);
  return true;
}

const leads = (text: string): boolean =>
  text === BASE_LORE_TOKEN || text.startsWith(`${BASE_LORE_TOKEN}\n`);

const strip = (text: string): string =>
  text === BASE_LORE_TOKEN ? "" : text.slice(BASE_LORE_TOKEN.length + 1);
