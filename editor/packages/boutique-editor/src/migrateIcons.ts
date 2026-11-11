import { menusOf } from "../../../src/domain/documents";
import type { Appearance, I18nKey, Project } from "../../../src/domain/types";

/** Move catalogue lore into icons and adapt their menu consumers. */
export function migrateIcons(raw: unknown): void {
  const project = raw as Project;
  const categories = project.dataSources?.find((s) => s.id === "categories" && s.shape === "table");
  if (!categories || categories.shape !== "table") return;
  const rows = categories.rows.flatMap((c) =>
    Array.isArray(c.items) ? (c.items as Record<string, unknown>[]) : [],
  );
  const model = project.dataModels?.find((m) => m.id === "boutique:item");
  if (!model) return;
  const refs: { app: Appearance; alias: string }[] = [];
  for (const menu of menusOf(project))
    for (const layer of menu.layers)
      for (const element of layer.elements) {
        const iteration = element.iterates ?? element.places;
        if (
          !iteration ||
          !(
            iteration.alias === "item" ||
            iteration.source.endsWith(".items") ||
            iteration.source === "boutique:items" ||
            menu.contextInputs?.some(
              (input) =>
                input.kind === "sourceRef" &&
                input.name === iteration.source &&
                input.ref === "boutique:items",
            )
          )
        )
          continue;
        for (const app of [element.display, ...element.states]) {
          if (!app) continue;
          const match = /^\{([\w]+)\.icon\}$/.exec(app.item ?? app.material ?? "");
          if (match && match[1] === (element.iterates ?? element.places)?.alias)
            refs.push({ app, alias: match[1]! });
        }
      }
  for (const row of rows) {
    const lore = Array.isArray(row.lore) ? row.lore : [];
    if (lore.length > 0) {
      // The base lore is kept by default: the catalogue lore is simply appended
      // below it, with no placeholder or explicit replacement.
      row.icon = { extends: row.icon, lore };
    }
    Reflect.deleteProperty(row, "lore");
  }
  for (const { app, alias } of refs) {
    if (!app.lore) continue;
    const old = project.i18nKeys[app.lore!.key] ?? {};
    const token = `{${alias}.lore}`;
    if (!Object.values(old).some((text) => text.includes(token))) continue;
    const key = `${app.lore!.key}.item_extension` as I18nKey;
    // The token places the icon's lore where the catalogue wrote it; a language
    // that did not carry it keeps the default (base lore on top).
    project.i18nKeys[key] = Object.fromEntries(
      Object.entries(old).map(([lang, text]) => [lang, text.replaceAll(token, "{base.lore}")]),
    );
    app.lore = { key };
  }
  model.fields = model.fields.filter((f) => f.name !== "lore");
}
