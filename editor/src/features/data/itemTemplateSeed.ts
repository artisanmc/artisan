import { visitItemTemplateLTexts } from "@/domain/i18nSites";
import type { Element, I18nKey, ItemTemplate, Project } from "@/domain/types";
import type { DataSourceSchemaField } from "@/lib/api/dataSources";

/**
 * Seeding helpers for Item template creation ("Créer un set d'items"). Pure:
 * they build `{ template, i18n }` — the template entity plus the i18n entries
 * (all languages) to merge into `pack.i18nKeys` — which `addItemTemplate`
 * persists in one store transaction. Keys are the template's canonical paths
 * (`item_templates.<id>.<state>.…`) so no later rekey is needed.
 */
export interface TemplateSeed {
  template: ItemTemplate;
  i18n: Record<I18nKey, Record<string, string>>;
}

type TemplateBase = Omit<ItemTemplate, "appearances">;

const findField = (schema: DataSourceSchemaField[], names: string[]): string | undefined =>
  names.find((n) => schema.some((f) => f.name === n));

/**
 * Heuristic seed from the source's declared schema: `icon`/`material` → material,
 * `name`/`title`/`label` → title, `final_price`/`price`/`description` → lore.
 * Falls back to a CHEST with the key field as title.
 */
export function seedTemplateFromSchema(
  base: TemplateBase,
  defaultLang: string,
  schema: DataSourceSchemaField[],
): TemplateSeed {
  const a = base.alias;
  const iconField = findField(schema, ["icon", "material"]);
  const nameField =
    findField(schema, ["name", "title", "label"]) ?? base.keyField ?? schema[0]?.name;
  const loreField = findField(schema, ["final_price", "price", "description", "lore"]);

  const titleKey = `item_templates.${base.id}.default.title` as I18nKey;
  const loreKey = `item_templates.${base.id}.default.lore` as I18nKey;
  const i18n: TemplateSeed["i18n"] = {};
  i18n[titleKey] = { [defaultLang]: nameField ? `{${a}.${nameField}}` : "" };
  if (loreField) i18n[loreKey] = { [defaultLang]: `{${a}.${loreField}}` };

  const template: ItemTemplate = {
    ...base,
    appearances: [
      {
        material: iconField ? `{${a}.${iconField}}` : "CHEST",
        title: { key: titleKey },
        ...(loreField ? { lore: { key: loreKey } } : {}),
      },
    ],
  };
  return { template, i18n };
}

/**
 * Seed from an element already consuming the source (highest fidelity: carries
 * the full appearance INCLUDING conditional states and click chains, e.g. the
 * buy action). Appearances are deep-cloned onto the template's canonical keys —
 * every language of every LText is copied, and the source element is untouched.
 * The alias is forced to the element's own so `{alias.field}` placeholders keep
 * resolving verbatim.
 */
export function seedTemplateFromElement(
  pack: Project,
  element: Element,
  base: TemplateBase,
): TemplateSeed {
  const alias = element.iterates?.alias ?? element.places?.alias ?? base.alias;
  const template: ItemTemplate = {
    ...base,
    alias,
    appearances: structuredClone(element.appearances),
  };
  const i18n: TemplateSeed["i18n"] = {};
  for (const site of visitItemTemplateLTexts(template)) {
    const entry = pack.i18nKeys[site.lText.key];
    if (entry) i18n[site.key] = { ...entry };
    site.lText.key = site.key; // repoint the clone to its canonical key
  }
  return { template, i18n };
}

/**
 * Find an element to seed from: one whose `iterates`/`places` source resolves —
 * through the owning menu's contextInputs — to `sourceRef`, and that has at
 * least one appearance. Returns the first match (bootstrap menus qualify).
 */
export function findSeedElement(
  pack: Project,
  sourceRef: string,
): { element: Element; menuId: string } | null {
  for (const menu of pack.menus) {
    const inputNames = new Set(
      (menu.contextInputs ?? [])
        .filter((c) => c.kind === "sourceRef" && String(c.ref) === sourceRef)
        .map((c) => c.name),
    );
    if (inputNames.size === 0) continue;
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        const src = el.iterates?.source ?? el.places?.source;
        if (src && inputNames.has(src) && el.appearances.length > 0) {
          return { element: el, menuId: menu.id };
        }
      }
    }
  }
  return null;
}
