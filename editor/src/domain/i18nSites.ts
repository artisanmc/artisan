import { type DeclaredActionLookup, declaredActionOf } from "@/lib/actions/coreActions";
import { createLTextAt, deleteLText } from "@/lib/i18n";
import {
  dialogBodyTextKey,
  dialogButtonKeyPrefix,
  dialogButtonLabelKey,
  dialogInputLabelKey,
  dialogOptionLabelKey,
  dialogTitleKey,
  menuTitleKey,
  moveLTextKey,
  stateLabel,
} from "@/lib/i18nKeys";
import { isLTextNode, walkStepTextSlots } from "./actionTextSlots";
import { walkCommandNodes } from "./commandNodes";
import {
  type ChainSlot,
  documentChainSlots,
  documentLTextSites,
  registerDocumentKindVisitors,
} from "./documentKindVisitors";
import { allDocuments } from "./documents";
import { addressedAppearances } from "./element";
import { itemTextFields } from "./itemTextFields";
import type {
  Appearance,
  Command,
  DataModel,
  DataModelId,
  DataSource,
  Dialog,
  Document,
  Element,
  I18nKey,
  LText,
  Menu,
  ModelFieldType,
  Project,
  Step,
} from "./types";

/**
 * Single traversal of every localizable-text **key site** in a project tree.
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
  | "commandDescription"
  | "dialogTitle"
  | "dialogBody"
  | "dialogInputLabel"
  | "dialogOptionLabel"
  | "dialogButtonLabel"
  /** A text argument of an action with no legacy slot: a module's, or a core text beyond message/title. */
  | "actionText";

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
 * Walk a Step tree's text slots ({@link walkStepTextSlots}: every `ltext` argument of
 * every declared action, core or module, addressed as the plugin addresses them) and
 * yield a site for each slot already holding an {@link LText} node. `prefix` is the
 * canonical key base of the owning handler (`…click.left`, `commands.give`,
 * `dialogs.x.buttons.btn`). A slot still holding its wire text (a module's action read
 * before the server declared it) is skipped here and adopted by {@link adoptActionTexts}.
 */
export function* visitStepLTexts(
  steps: Step[],
  prefix: string,
  declOf: DeclaredActionLookup = declaredActionOf,
): Generator<LTextSite> {
  for (const slot of walkStepTextSlots(steps, prefix, declOf)) {
    const lText = slot.get();
    if (!isLTextNode(lText)) continue;
    yield { lText, key: slot.key, path: slot.path, kind: siteKindOf(slot.slot) };
  }
}

function siteKindOf(slot: string | null): SiteKind {
  switch (slot) {
    case "message":
      return "message";
    case "show_title":
      return "showTitle";
    case "show_subtitle":
      return "showSubtitle";
    default:
      return "actionText";
  }
}

/**
 * Adopt the wire texts of a Step tree into LText nodes (the action half of ADR
 * `bare-data-files` ④): a module's action is read verbatim when the server has not
 * declared it yet, so its `ltext` arguments hold a string or a `{lang: text}` map. Once
 * the declaration is known, each such text becomes a node at the slot's canonical
 * address, its languages stored under that key (a bare string is the default language's).
 * Idempotent; nodes pass through untouched.
 */
export function adoptActionTexts(
  project: Project,
  steps: Step[],
  prefix: string,
  declOf: DeclaredActionLookup = declaredActionOf,
): void {
  for (const slot of walkStepTextSlots(steps, prefix, declOf)) {
    const value = slot.get();
    if (isLTextNode(value)) continue;
    const entry: Record<string, string> =
      typeof value === "string"
        ? { [project.defaultLang]: value }
        : typeof value === "object" && value !== null && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                (e): e is [string, string] => typeof e[1] === "string",
              ),
            )
          : { [project.defaultLang]: value == null ? "" : String(value) };
    project.i18nKeys[slot.key] = { ...(project.i18nKeys[slot.key] ?? {}), ...entry };
    slot.set({ key: slot.key });
  }
}

/** Every action chain of a project with its canonical key prefix: click handlers, commands, dialog buttons. */
export function* visitProjectStepChains(
  project: Project,
): Generator<{ steps: Step[]; prefix: string }> {
  for (const { kind, doc } of allDocuments(project)) yield* documentChainSlots(kind, doc);
}

/** The action chains of a menu: one per click handler of each element appearance. */
export function* menuChainSlots(menu: Menu): Generator<ChainSlot> {
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearances = addressedAppearances(el);
      for (let i = 0; i < appearances.length; i++) {
        const appearance = appearances[i]!;
        if (!appearance.click) continue;
        const base = `menus.${menu.id}.elements.${el.id}.${stateLabel(i)}`;
        for (const [clickType, handler] of Object.entries(appearance.click)) {
          if (!handler) continue;
          yield {
            name: `${el.id}.${clickType}`,
            steps: handler.steps,
            prefix: `${base}.click.${clickType}`,
            label: appearance.material ?? el.display.material ?? "",
          };
        }
      }
    }
  }
}

/** The action chains of a command: its invocation, then each sub-command's (`invoke sell`). */
export function* commandChainSlots(command: Command): Generator<ChainSlot> {
  for (const { node, words, prefix } of walkCommandNodes(command))
    yield { name: ["invoke", ...words.slice(1)].join(" "), steps: node.steps, prefix };
}

/** The action chains of a dialog: one per button. */
export function* dialogChainSlots(dialog: Dialog): Generator<ChainSlot> {
  for (const btn of dialog.buttons)
    yield { name: btn.id, steps: btn.steps, prefix: dialogButtonKeyPrefix(dialog.id, btn.id) };
}

/** {@link adoptActionTexts} over every action chain of the project. */
export function adoptProjectActionTexts(
  project: Project,
  declOf: DeclaredActionLookup = declaredActionOf,
): void {
  for (const { steps, prefix } of visitProjectStepChains(project))
    adoptActionTexts(project, steps, prefix, declOf);
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
    // `lore` is a single LText in the current shape, but legacy-migrated projects
    // can carry an array. Tolerate both so those projects don't read as "(unused)".
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

/** Yield every site of one element — its display, then each of its states.
 *  Addressing order, so the display keeps the `default` segment. */
export function* visitElementLTexts(menuId: string, element: Element): Generator<LTextSite> {
  const appearances = addressedAppearances(element);
  for (let i = 0; i < appearances.length; i++) {
    const base = `menus.${menuId}.elements.${element.id}.${stateLabel(i)}`;
    yield* visitAppearanceLTexts(appearances[i]!, base);
  }
}

/** Yield every site of a menu — title layers + every element appearance. */
export function* visitMenuLTexts(menu: Menu): Generator<LTextSite> {
  yield* visitMenuTitleLTexts(menu);
  for (const layer of menu.layers) {
    for (const el of layer.elements) yield* visitElementLTexts(menu.id, el);
  }
}

/** Yield every site of a command: per node, its description then its step tree. */
export function* visitCommandLTexts(command: Command): Generator<LTextSite> {
  for (const { node, words, prefix } of walkCommandNodes(command)) {
    if (node.description) {
      const key = `${prefix}.description` as I18nKey;
      yield {
        lText: node.description,
        key,
        // Readable in the Translations tab: the command as typed, not the node's index.
        path: `commands.${command.id}${words
          .slice(1)
          .map((w) => ` ${w}`)
          .join("")}.description`,
        kind: "commandDescription",
      };
    }
    yield* visitStepLTexts(node.steps, prefix);
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
    case "item": {
      const obj = value as Record<string, unknown>;
      for (const field of itemTextFields(value))
        yield* visitModelValueLTexts(
          obj[field.name],
          field.type,
          `${base}.${field.name}`,
          models,
          visited,
        );
      return;
    }
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
      yield* visitModelValueLTexts(
        value,
        { kind: "object", fields: model.fields },
        base,
        models,
        next,
      );
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
      yield* visitModelValueLTexts(
        value,
        { kind: "object", fields: variant.fields },
        base,
        models,
        visited,
      );
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
export function* visitDataSourceLTexts(project: Project, ds: DataSource): Generator<LTextSite> {
  const models = project.dataModels ?? [];
  // Addressed by ID, not display name (ADR bare-data-files ④: "the address does
  // not change") — renaming a source must not re-address every key, and the
  // plugin derives the same address from the file name at resolve time.
  const sourceKey = String(ds.id).toLowerCase();
  if (ds.shape === "table") {
    const model = models.find((m) => m.id === ds.modelId);
    if (!model) return;
    const rowKeyCounts = new Map<string, number>();
    for (const row of ds.rows) {
      const raw = row[model.keyField];
      const value =
        typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
      if (value !== "") rowKeyCounts.set(value, (rowKeyCounts.get(value) ?? 0) + 1);
    }
    for (let i = 0; i < ds.rows.length; i++) {
      const row = ds.rows[i]!;
      const raw = row[model.keyField];
      const keyVal =
        typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
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

/**
 * Yield every key site in a project: every Document through its kind's visitor
 * (`documentKindVisitors`), then the data sources. A kind without a visitor has no
 * site: its texts are not in `i18nKeys`.
 */
export function* visitProjectLTexts(project: Project): Generator<LTextSite> {
  for (const { kind, doc } of allDocuments(project)) yield* documentLTextSites(kind, doc);
  for (const ds of project.dataSources ?? []) yield* visitDataSourceLTexts(project, ds);
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
export function adoptBareLTexts(project: Project, ds: DataSource): void {
  const models = project.dataModels ?? [];
  const sourceKey = String(ds.id).toLowerCase();
  const adopt = (
    value: unknown,
    type: ModelFieldType,
    base: string,
    visited: Set<DataModelId>,
  ): unknown => {
    switch (type.kind) {
      case "item": {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        const obj = { ...value } as Record<string, unknown>;
        for (const field of itemTextFields(value))
          obj[field.name] = adopt(obj[field.name], field.type, `${base}.${field.name}`, visited);
        return obj;
      }
      case "ltext": {
        if (isLTextNode(value)) return value;
        const s = typeof value === "string" ? value : "";
        if (s !== "" && project.i18nKeys[s as I18nKey]) return { key: s as I18nKey };
        const a = base as I18nKey;
        project.i18nKeys[a] = { ...(project.i18nKeys[a] ?? {}), [project.defaultLang]: s };
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
        return adopt(
          value,
          { kind: "object", fields: model.fields },
          base,
          new Set(visited).add(type.ref),
        );
      }
      case "map": {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
        const obj = { ...(value as Record<string, unknown>) };
        for (const [k, v] of Object.entries(obj))
          obj[k] = adopt(v, type.of, `${base}.${k.toLowerCase()}`, visited);
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
      const v =
        typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
      if (v !== "") rowKeyCounts.set(v, (rowKeyCounts.get(v) ?? 0) + 1);
    }
    for (let i = 0; i < ds.rows.length; i++) {
      const raw = ds.rows[i]![model.keyField];
      const keyVal =
        typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
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

/**
 * Reattach the disk translations addressed to each key site — the import half
 * of inline mode, and the same move the data-source reader already makes (ADR
 * bare-data-files ④).
 *
 * An inline document holds only the default language's literal, so the reader
 * mints a fresh key for it, and the `lang/<lang>.yaml` entries addressed to
 * that site would otherwise float free (listed in the Translations panel,
 * attached to nothing, dropped at the next export). Rekey the node to its
 * address and merge — the literal read from the document wins for the default
 * language.
 *
 * Skipped for a node whose key is itself a translated disk key (an authored
 * `{i18n:key}` ref, shared or not): that key is content, not a mint.
 */
export function adoptAddressedTranslations(
  project: Project,
  disk: Record<string, Record<string, string>>,
): void {
  for (const site of visitProjectLTexts(project)) {
    const key = site.lText.key;
    if (key === site.key || disk[key]) continue;
    project.i18nKeys[site.key] = { ...(disk[site.key] ?? {}), ...(project.i18nKeys[key] ?? {}) };
    delete project.i18nKeys[key];
    site.lText.key = site.key;
  }
}

// Rekey: assign every site its canonical key.
// Lazy canonicalization at the deploy/export/persist boundary. Folds over the
// traversal above; idempotent (moveLTextKey no-ops when already correct). Safe
// inside an immer producer.

function rekey(project: Project, sites: Iterable<LTextSite>): void {
  for (const site of sites) moveLTextKey(project, site.lText, site.key);
}

/** Canonicalize one menu's LText keys (title layers + every element). */
export function rekeyMenu(project: Project, menu: Menu): void {
  rekey(project, visitMenuLTexts(menu));
}

/** Canonicalize one command's LText keys. */
export function rekeyCommand(project: Project, command: Command): void {
  rekey(project, visitCommandLTexts(command));
}

/** Canonicalize every LText key owned by one Project data source. */
export function rekeyDataSource(project: Project, dataSource: DataSource): void {
  rekey(project, visitDataSourceLTexts(project, dataSource));
}

/** Canonicalize one Document's LText keys through its kind's visitor (after a rename, say). */
export function rekeyDocument(project: Project, kind: string, doc: Document): void {
  rekey(project, documentLTextSites(kind, doc));
}

/** Release every text one Document owns, before it leaves the project. */
export function gcDocumentLTexts(project: Project, kind: string, doc: Document): void {
  releaseLTexts(project, documentLTextSites(kind, doc));
}

/**
 * Canonicalize every LText key in the project — menus, commands, templates, and
 * dialogs. The single deploy-time canonicalizer; replaces the per-entity
 * `for (menu) … for (cmd) …` loops at the export/persist/deploy seams.
 */
export function rekeyProject(project: Project): void {
  rekey(project, visitProjectLTexts(project));
}

// Mint / release: per-mutation key lifecycle.
// Folds the per-mutation alloc/gc lifecycle over the same traversal. Both are
// immer-safe and operate in place on the live nodes the visitor yields.

/**
 * Seed an i18n entry for every site whose node still holds the unallocated
 * sentinel (`key === ""`), under the site's canonical key. Mirrors the old
 * `allocStepLTexts`. Non-sentinel sites (already-keyed titles/lore/labels) are
 * skipped, so it is safe to run over a whole subtree, not just step actions.
 */
export function mintLTexts(project: Project, sites: Iterable<LTextSite>, lang: string): void {
  for (const site of sites) {
    if (site.lText.key === ("" as I18nKey)) {
      createLTextAt(project, site.key, "", lang);
      site.lText.key = site.key;
    }
  }
}

/**
 * Drop the i18n entry of every site's node. Use when removing a subtree so the
 * project's lang map doesn't leak orphans. Mirrors the old `gc*LTexts` family;
 * `release` ignores each site's canonical `key`, so callers walking a subtree
 * for deletion may pass any key prefix.
 */
export function releaseLTexts(project: Project, sites: Iterable<LTextSite>): void {
  for (const site of sites) deleteLText(project, site.lText);
}

// The core kinds walk themselves the way a module's kind does (dogfood): the same
// registry serves `visitProjectLTexts`, `visitProjectStepChains`, the rekey and the GC.
registerDocumentKindVisitors("menu", {
  ltextSites: (doc) => visitMenuLTexts(doc as Menu),
  chainSlots: (doc) => menuChainSlots(doc as Menu),
});
registerDocumentKindVisitors("command", {
  ltextSites: (doc) => visitCommandLTexts(doc as Command),
  chainSlots: (doc) => commandChainSlots(doc as Command),
});
registerDocumentKindVisitors("dialog", {
  ltextSites: (doc) => visitDialogLTexts(doc as Dialog),
  chainSlots: (doc) => dialogChainSlots(doc as Dialog),
});
