import { createLTextAt, deleteLText } from "@/lib/i18n";
import {
  commandKeyPrefix,
  dialogBodyTextKey,
  dialogButtonKeyPrefix,
  dialogButtonLabelKey,
  dialogInputLabelKey,
  dialogOptionLabelKey,
  dialogTitleKey,
  menuTitleKey,
  messageKeyAt,
  moveLTextKey,
  showSubtitleKeyAt,
  showTitleKeyAt,
  stateLabel,
} from "@/lib/i18nKeys";
import { walkActions } from "./stepPath";
import type {
  Appearance,
  Command,
  DataModel,
  DataModelId,
  DataSource,
  Dialog,
  I18nKey,
  ItemTemplate,
  LText,
  Menu,
  ModelFieldType,
  Project,
  Step,
  Template,
} from "./types";

/**
 * Single traversal of every localizable-text **key site** in a pack tree.
 *
 * A key site is one slot holding an {@link LText} — a menu title layer, an
 * appearance's title/lore, a `send_message`/`show_title` action, a dialog
 * label. Each site carries:
 *
 *   - `lText` — the **live** node. Read `.key` to inspect (usages, validation)
 *     or reassign it (rekey, mint) — every i18n lifecycle op folds over this.
 *   - `key`   — the **canonical** position-derived key the site should hold at
 *     deploy time (what `rekeyProject` assigns; what `mint` seeds).
 *   - `path`  — the **display** path shown in the Translations panel / YAML
 *     comments. Mostly mirrors `key` but coarser: message index collapses
 *     (`…message` not `…message_1`), `show_title` reads as `…show_title.title`,
 *     multi-title layers read as `…title[i]`.
 *
 * This module is the single owner of the position → key mapping. The eleven
 * walks that used to re-derive it (findKeyUsages, validate, rekey*, alloc*,
 * gc*) collapse to folds over these generators. See CONTEXT.md "Key site".
 */
export type SiteKind =
  | "menuTitle"
  | "appearanceTitle"
  | "lore"
  | "message"
  | "showTitle"
  | "showSubtitle"
  | "sourceField"
  | "dialogTitle"
  | "dialogBody"
  | "dialogInputLabel"
  | "dialogOptionLabel"
  | "dialogButtonLabel";

export interface LTextSite {
  /** Live node — read or reassign its `.key`. */
  lText: LText;
  /** Canonical position-derived key (rekey / mint target). */
  key: I18nKey;
  /** Human display path (Translations panel + YAML comments). */
  path: string;
  kind: SiteKind;
}

/** Display label for a site — the dotted-path "context" string. */
export const label = (site: LTextSite): string => site.path;

/**
 * Walk a Step tree's actions in {@link walkActions} order, yielding a site for
 * every `send_message` / `broadcast` / `show_title` LText. `prefix` is the
 * canonical key base of the owning handler (`…click.left`, `commands.give`,
 * `dialogs.x.buttons.btn`). Counters per message/title/subtitle mirror the
 * historic alloc/rekey schemes exactly — this is the one place they live now.
 */
export function* visitStepLTexts(steps: Step[], prefix: string): Generator<LTextSite> {
  let msgIdx = 0;
  let titleIdx = 0;
  let subtitleIdx = 0;
  for (const action of walkActions(steps)) {
    if (action.type === "send_message" || action.type === "broadcast") {
      yield {
        lText: action.text,
        key: messageKeyAt(prefix, msgIdx),
        path: `${prefix}.message`,
        kind: "message",
      };
      msgIdx++;
    } else if (action.type === "show_title") {
      yield {
        lText: action.title,
        key: showTitleKeyAt(prefix, titleIdx),
        path: `${prefix}.show_title.title`,
        kind: "showTitle",
      };
      titleIdx++;
      if (action.subtitle) {
        yield {
          lText: action.subtitle,
          key: showSubtitleKeyAt(prefix, subtitleIdx),
          path: `${prefix}.show_title.subtitle`,
          kind: "showSubtitle",
        };
        subtitleIdx++;
      }
    }
  }
}

/**
 * Yield the title, lore, and click-action sites of one appearance. `base` is
 * the canonical key prefix of the appearance — `menus.<m>.elements.<e>.<state>`
 * for an element, `templates.<t>.<state>` for a template appearance. For
 * appearance title/lore `path === key`; click steps diverge only in suffix.
 */
export function* visitAppearanceLTexts(appearance: Appearance, base: string): Generator<LTextSite> {
  if (appearance.title) {
    yield {
      lText: appearance.title,
      key: `${base}.title` as I18nKey,
      path: `${base}.title`,
      kind: "appearanceTitle",
    };
  }
  if (appearance.lore) {
    // `lore` is a single LText in the current shape, but legacy-migrated packs
    // can carry an array. Tolerate both so those packs don't read as "(unused)".
    const loreRefs = Array.isArray(appearance.lore) ? appearance.lore : [appearance.lore];
    for (const lt of loreRefs) {
      if (lt)
        yield { lText: lt, key: `${base}.lore` as I18nKey, path: `${base}.lore`, kind: "lore" };
    }
  }
  if (appearance.click) {
    for (const [clickType, handler] of Object.entries(appearance.click)) {
      if (!handler) continue;
      yield* visitStepLTexts(handler.steps, `${base}.click.${clickType}`);
    }
  }
}

/** Yield the text-bearing title layers of a menu in stack order. */
function* visitMenuTitleLTexts(menu: Menu): Generator<LTextSite> {
  const base = menuTitleKey(menu.id);
  const textLayers = menu.title.filter(
    (l) => l.kind === "text" || l.kind === "plain" || l.kind === "textarea",
  );
  for (let i = 0; i < textLayers.length; i++) {
    // First text layer → `menus.<id>.title`; subsequent → `…title_2`, `…title_3`.
    const key = (i === 0 ? base : `${base}_${i + 1}`) as I18nKey;
    // Display collapses to `title` when single, `title[i]` when multiple.
    const path = textLayers.length > 1 ? `${base}[${i}]` : base;
    // Narrowed by the filter above — these kinds carry `value: LText`.
    const value = (textLayers[i] as Extract<(typeof textLayers)[number], { value: LText }>).value;
    yield { lText: value, key, path, kind: "menuTitle" };
  }
}

/** Yield every site of one element across all its appearances. */
export function* visitElementLTexts(
  menuId: string,
  element: { id: string; appearances: Appearance[] },
): Generator<LTextSite> {
  for (let i = 0; i < element.appearances.length; i++) {
    const base = `menus.${menuId}.elements.${element.id}.${stateLabel(i)}`;
    yield* visitAppearanceLTexts(element.appearances[i]!, base);
  }
}

/** Yield every site of a menu — title layers + every element appearance. */
export function* visitMenuLTexts(menu: Menu): Generator<LTextSite> {
  yield* visitMenuTitleLTexts(menu);
  for (const layer of menu.layers) {
    for (const el of layer.elements) yield* visitElementLTexts(menu.id, el);
  }
}

/** Yield every site of a command's step tree. */
export function* visitCommandLTexts(command: Command): Generator<LTextSite> {
  yield* visitStepLTexts(command.steps, commandKeyPrefix(command.id));
}

/** Yield every site of a template's appearances. */
export function* visitTemplateLTexts(template: Template): Generator<LTextSite> {
  for (let i = 0; i < template.appearances.length; i++) {
    const base = `templates.${template.id}.${stateLabel(i)}`;
    yield* visitAppearanceLTexts(template.appearances[i]!, base);
  }
}

/** Yield every site of an Item template's appearances (title/lore/click LTexts). */
export function* visitItemTemplateLTexts(tpl: ItemTemplate): Generator<LTextSite> {
  for (let i = 0; i < tpl.appearances.length; i++) {
    const base = `item_templates.${tpl.id}.${stateLabel(i)}`;
    yield* visitAppearanceLTexts(tpl.appearances[i]!, base);
  }
}

/** Yield every site of a dialog — title, body, input/option/button labels, button steps. */
export function* visitDialogLTexts(dialog: Dialog): Generator<LTextSite> {
  const titleKey = dialogTitleKey(dialog.id);
  yield { lText: dialog.title, key: titleKey, path: titleKey, kind: "dialogTitle" };

  for (let i = 0; i < dialog.body.length; i++) {
    const b = dialog.body[i]!;
    if (b.type === "text") {
      yield {
        lText: b.text,
        key: dialogBodyTextKey(dialog.id, i),
        path: `dialogs.${dialog.id}.body[${i}]`,
        kind: "dialogBody",
      };
    }
  }

  for (const inp of dialog.inputs) {
    const labelKey = dialogInputLabelKey(dialog.id, inp.id);
    yield { lText: inp.label, key: labelKey, path: labelKey, kind: "dialogInputLabel" };
    if (inp.type === "single_option") {
      for (const opt of inp.options) {
        const optKey = dialogOptionLabelKey(dialog.id, inp.id, opt.value);
        yield { lText: opt.label, key: optKey, path: optKey, kind: "dialogOptionLabel" };
      }
    }
  }

  for (const btn of dialog.buttons) {
    const btnKey = dialogButtonLabelKey(dialog.id, btn.id);
    yield { lText: btn.label, key: btnKey, path: btnKey, kind: "dialogButtonLabel" };
    yield* visitStepLTexts(btn.steps, dialogButtonKeyPrefix(dialog.id, btn.id));
  }
}

/** LText-shaped live node guard — row values are untrusted (`unknown`). */
function isLTextNode(v: unknown): v is LText {
  return typeof v === "object" && v !== null && typeof (v as { key?: unknown }).key === "string";
}

/**
 * Walk one value against its declared {@link ModelFieldType}, yielding a site
 * per ltext leaf. `base` is the canonical key prefix (`sources.<name>.<rowKey>`
 * for a table row, `sources.<name>` for a config). List entries follow the
 * `_${i+1}` suffix convention (`perks`, `perks_2`); non-conforming values are
 * skipped defensively (never throw over authored data).
 */
function* visitModelValueLTexts(
  value: unknown,
  type: ModelFieldType,
  base: string,
  models: DataModel[],
  visited: Set<DataModelId>,
): Generator<LTextSite> {
  switch (type.kind) {
    case "ltext":
      if (isLTextNode(value)) {
        yield { lText: value, key: base as I18nKey, path: base, kind: "sourceField" };
      }
      return;
    case "list": {
      if (!Array.isArray(value)) return;
      for (let i = 0; i < value.length; i++) {
        const entryBase = i === 0 ? base : `${base}_${i + 1}`;
        yield* visitModelValueLTexts(value[i], type.of, entryBase, models, visited);
      }
      return;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      const obj = value as Record<string, unknown>;
      for (const f of type.fields) {
        yield* visitModelValueLTexts(
          obj[f.name],
          f.type,
          `${base}.${f.name.toLowerCase()}`,
          models,
          visited,
        );
      }
      return;
    }
    case "model": {
      if (visited.has(type.ref)) return;
      const model = models.find((m) => m.id === type.ref);
      if (!model) return;
      const next = new Set(visited).add(type.ref);
      yield* visitModelValueLTexts(value, { kind: "object", fields: model.fields }, base, models, next);
      return;
    }
    case "map": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        yield* visitModelValueLTexts(v, type.of, `${base}.${k.toLowerCase()}`, models, visited);
      }
      return;
    }
    case "union": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      const obj = value as Record<string, unknown>;
      const variant = type.variants.find((v) => v.name === obj[type.tag]);
      if (!variant) return;
      yield* visitModelValueLTexts(value, { kind: "object", fields: variant.fields }, base, models, visited);
      return;
    }
    default:
      return;
  }
}

/**
 * Yield every ltext site of one Project source. Table rows key on the row's
 * **Row key** value (`sources.<name>.<rowKey>.<fieldPath>`) so keys survive
 * reordering; empty or duplicate key values fall back to `row_<n>`
 * (positional) until the admin resolves them. Cf. ADR
 * `project-sources-and-data-models`.
 */
export function* visitDataSourceLTexts(pack: Project, ds: DataSource): Generator<LTextSite> {
  const models = pack.dataModels ?? [];
  // Addressed by ID, not display name (ADR bare-data-files ④: "l'adresse ne
  // change pas") — renaming a source must not re-address every key, and the
  // plugin derives the same address from the file name at resolve time.
  const sourceKey = String(ds.id).toLowerCase();
  if (ds.shape === "table") {
    const model = models.find((m) => m.id === ds.modelId);
    if (!model) return;
    const rowKeyCounts = new Map<string, number>();
    for (const row of ds.rows) {
      const raw = row[model.keyField];
      const value =
        typeof raw === "string" || typeof raw === "number"
          ? String(raw).trim().toLowerCase()
          : "";
      if (value !== "") rowKeyCounts.set(value, (rowKeyCounts.get(value) ?? 0) + 1);
    }
    for (let i = 0; i < ds.rows.length; i++) {
      const row = ds.rows[i]!;
      const raw = row[model.keyField];
      const keyVal =
        typeof raw === "string" || typeof raw === "number"
          ? String(raw).trim().toLowerCase()
          : "";
      const rowKey = keyVal !== "" && rowKeyCounts.get(keyVal) === 1 ? keyVal : `row_${i + 1}`;
      yield* visitModelValueLTexts(
        row,
        { kind: "object", fields: model.fields },
        `sources.${sourceKey}.${rowKey}`,
        models,
        new Set([model.id]),
      );
    }
  } else {
    yield* visitModelValueLTexts(
      ds.value,
      { kind: "object", fields: ds.fields },
      `sources.${sourceKey}`,
      models,
      new Set(),
    );
  }
}

/** Yield every key site in a pack: menus, commands, templates, item templates, dialogs, sources. */
export function* visitProjectLTexts(pack: Project): Generator<LTextSite> {
  for (const menu of pack.menus ?? []) yield* visitMenuLTexts(menu);
  for (const cmd of pack.commands ?? []) yield* visitCommandLTexts(cmd);
  for (const tpl of pack.templates ?? []) yield* visitTemplateLTexts(tpl);
  for (const tpl of pack.itemTemplates ?? []) yield* visitItemTemplateLTexts(tpl);
  for (const dlg of pack.dialogs ?? []) yield* visitDialogLTexts(dlg);
  for (const ds of pack.dataSources ?? []) yield* visitDataSourceLTexts(pack, ds);
}

/**
 * Adopt BARE values into LText nodes (ADR bare-data-files ④) — used when a
 * source's model becomes known AFTER its rows were imported untyped (declared
 * models arrive via Presence): every plain string at an ltext site becomes an
 * LText node — a string matching a known i18n key resolves as that key
 * (legacy form); anything else is the DEFAULT language's literal, stored
 * under the site's canonical address (other languages already live there
 * from lang/ files). Idempotent; typed values pass through untouched.
 */
export function adoptBareLTexts(pack: Project, ds: DataSource): void {
  const models = pack.dataModels ?? [];
  const sourceKey = String(ds.id).toLowerCase();
  const adopt = (
    value: unknown,
    type: ModelFieldType,
    base: string,
    visited: Set<DataModelId>,
  ): unknown => {
    switch (type.kind) {
      case "ltext": {
        if (isLTextNode(value)) return value;
        const s = typeof value === "string" ? value : "";
        if (s !== "" && pack.i18nKeys[s as I18nKey]) return { key: s as I18nKey };
        const a = base as I18nKey;
        pack.i18nKeys[a] = { ...(pack.i18nKeys[a] ?? {}), [pack.defaultLang]: s };
        return { key: a };
      }
      case "list":
        return Array.isArray(value)
          ? value.map((el, i) => adopt(el, type.of, i === 0 ? base : `${base}_${i + 1}`, visited))
          : value;
      case "object": {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
        const obj = { ...(value as Record<string, unknown>) };
        for (const f of type.fields) {
          if (f.name in obj) {
            obj[f.name] = adopt(obj[f.name], f.type, `${base}.${f.name.toLowerCase()}`, visited);
          }
        }
        return obj;
      }
      case "model": {
        if (visited.has(type.ref)) return value;
        const model = models.find((m) => m.id === type.ref);
        if (!model) return value;
        return adopt(value, { kind: "object", fields: model.fields }, base, new Set(visited).add(type.ref));
      }
      case "map": {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
        const obj = { ...(value as Record<string, unknown>) };
        for (const [k, v] of Object.entries(obj)) obj[k] = adopt(v, type.of, `${base}.${k.toLowerCase()}`, visited);
        return obj;
      }
      case "union": {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
        const obj = value as Record<string, unknown>;
        const variant = type.variants.find((v) => v.name === obj[type.tag]);
        if (!variant) return value;
        return adopt(value, { kind: "object", fields: variant.fields }, base, visited);
      }
      default:
        return value;
    }
  };
  if (ds.shape === "table") {
    const model = models.find((m) => m.id === ds.modelId);
    if (!model) return;
    const rowKeyCounts = new Map<string, number>();
    for (const row of ds.rows) {
      const raw = row[model.keyField];
      const v = typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
      if (v !== "") rowKeyCounts.set(v, (rowKeyCounts.get(v) ?? 0) + 1);
    }
    for (let i = 0; i < ds.rows.length; i++) {
      const raw = ds.rows[i]![model.keyField];
      const keyVal = typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
      const rowKey = keyVal !== "" && rowKeyCounts.get(keyVal) === 1 ? keyVal : `row_${i + 1}`;
      ds.rows[i] = adopt(
        ds.rows[i],
        { kind: "object", fields: model.fields },
        `sources.${sourceKey}.${rowKey}`,
        new Set([model.id]),
      ) as Record<string, unknown>;
    }
  } else {
    ds.value = adopt(
      ds.value,
      { kind: "object", fields: ds.fields },
      `sources.${sourceKey}`,
      new Set(),
    ) as Record<string, unknown>;
  }
}

// ── Rekey: assign every site its canonical key ───────────────────────────────
// Lazy canonicalization at the deploy/export/persist boundary. Folds over the
// traversal above; idempotent (moveLTextKey no-ops when already correct). Safe
// inside an immer producer.

function rekey(pack: Project, sites: Iterable<LTextSite>): void {
  for (const site of sites) moveLTextKey(pack, site.lText, site.key);
}

/** Canonicalize one menu's LText keys (title layers + every element). */
export function rekeyMenu(pack: Project, menu: Menu): void {
  rekey(pack, visitMenuLTexts(menu));
}

/** Canonicalize one command's LText keys. */
export function rekeyCommand(pack: Project, command: Command): void {
  rekey(pack, visitCommandLTexts(command));
}

/** Canonicalize every LText key owned by one Project data source. */
export function rekeyDataSource(pack: Project, dataSource: DataSource): void {
  rekey(pack, visitDataSourceLTexts(pack, dataSource));
}

/**
 * Canonicalize every LText key in the pack — menus, commands, templates, and
 * dialogs. The single deploy-time canonicalizer; replaces the per-entity
 * `for (menu) … for (cmd) …` loops at the export/persist/deploy seams.
 */
export function rekeyProject(pack: Project): void {
  rekey(pack, visitProjectLTexts(pack));
}

// ── Mint / release: per-mutation key lifecycle ───────────────────────────────
// Folds the per-mutation alloc/gc lifecycle over the same traversal. Both are
// immer-safe and operate in place on the live nodes the visitor yields.

/**
 * Seed an i18n entry for every site whose node still holds the unallocated
 * sentinel (`key === ""`), under the site's canonical key. Mirrors the old
 * `allocStepLTexts`. Non-sentinel sites (already-keyed titles/lore/labels) are
 * skipped, so it is safe to run over a whole subtree, not just step actions.
 */
export function mintLTexts(pack: Project, sites: Iterable<LTextSite>, lang: string): void {
  for (const site of sites) {
    if (site.lText.key === ("" as I18nKey)) {
      createLTextAt(pack, site.key, "", lang);
      site.lText.key = site.key;
    }
  }
}

/**
 * Drop the i18n entry of every site's node. Use when removing a subtree so the
 * pack's lang map doesn't leak orphans. Mirrors the old `gc*LTexts` family;
 * `release` ignores each site's canonical `key`, so callers walking a subtree
 * for deletion may pass any key prefix.
 */
export function releaseLTexts(pack: Project, sites: Iterable<LTextSite>): void {
  for (const site of sites) deleteLText(pack, site.lText);
}
