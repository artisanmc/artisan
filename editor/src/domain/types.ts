/**
 * Domain types for the Artisan editor scaffold.
 *
 * - References (open_menu, source ref, i18n key) may dangle: a target id
 *   that doesn't resolve at runtime is a no-op (or the plugin surfaces an
 *   error to the player). The editor doesn't enforce hermeticity — projects
 *   can freely reference each other or have stale ids.
 * - "Element" is the canonical name (per main-spec §8.1); the old "Slot" name
 *   from the prior proto is dropped.
 */

import type { ItemEnchant, ItemHideFlag } from "./itemAdvanced";

export type { ItemEnchant, ItemHideFlag };

export type AccountId = string & { __brand: "AccountId" };
export type ProjectId = string & { __brand: "ProjectId" };
export type MenuId = string & { __brand: "MenuId" };
export type CommandId = string & { __brand: "CommandId" };
export type CapturedItemId = string & { __brand: "CapturedItemId" };
export type AssetId = string & { __brand: "AssetId" };
export type ElementId = string & { __brand: "ElementId" };
export type LayerId = string & { __brand: "LayerId" };
export type I18nKey = string & { __brand: "I18nKey" };
export type DataSourceId = string & { __brand: "DataSourceId" };
export type DataModelId = string & { __brand: "DataModelId" };
export type SourceRef = string & { __brand: "SourceRef" };
export type DialogId = string & { __brand: "DialogId" };

/**
 * Reference to a localizable string. The actual translations live in
 * `Project.i18nKeys[key][lang]`. Keys are opaque random ids generated at
 * field creation time — stable across renames of the surrounding entity
 * (menu/element/etc.) so translations don't break when ids change.
 *
 * The user never sees keys: the editor reads through `getText` and writes
 * through `setLText`, both of which take the active language from the UI
 * store and fall back to `Project.defaultLang` when the active language has
 * no entry yet.
 */
export interface LText {
  key: I18nKey;
}

/**
 * Discrete font heights for `text` and `textarea` title layers. The backend
 * bakes one resource-pack font variant per (Y, size) pair. Restricted to
 * vanilla and upscale multiples — downscale (h<8) was dropped because
 * nearest-neighbor downsampling renders ASCII glyphs illegible and MC's
 * 1-pixel bold offset becomes visually dominant. Default 8 = vanilla.
 */
export type TextSize = 8 | 12 | 16 | 20 | 24 | 32;

export type MenuTitleLayer =
  | { kind: "background"; assetId: AssetId }
  | { kind: "glyph"; assetId: AssetId; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number;
      fontAssetId?: AssetId;
      color?: string;
      size?: TextSize }
  /** Plain vanilla title — no resource project required. Emitted as a raw
   *  MiniMessage string in YAML (legacy format) so any server can use it. */
  | { kind: "plain"; value: LText; color?: string }
  /** Multi-line text block. `value` resolves to a string containing literal
   *  `\n`s; the runtime splits and renders one line per split at
   *  `(x, y + i * lineHeight)`. Lines share alignment + optional font. */
  | { kind: "textarea"; value: LText; x: number; y: number;
      width: number;
      lineHeight: number;
      alignment: "left" | "center" | "right";
      fontAssetId?: AssetId;
      size?: TextSize }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder";
      glyphName: string; x: number; y: number };

export type ProjectSource = "user_created" | "imported" | "forked";

export interface Account {
  id: AccountId;
  projects: Project[];
  projectOrder: ProjectId[];
}

export type AnchorSide = "top" | "right" | "bottom" | "left";

/** Endpoint override for a canvas edge — a position on a node border. */
export interface EdgeAnchor {
  side: AnchorSide;
  /** Ratio 0..1 along the side (survives node resize). */
  t: number;
}

export interface Project {
  id: ProjectId;
  /**
   * Forme URL du project (unique par serveur). Présent dès qu'il vient du
   * backend ; absent pour un project purement local. L'id reste l'identité —
   * le slug ne sert qu'à reconnaître un project désigné par une URL.
   */
  slug?: string;
  /**
   * L'id que le SERVEUR propriétaire utilise sur disque et sur le fil — le nom
   * du dossier `plugins/Artisan/projects/<diskId>/`, donc le préfixe de toutes
   * les clés de `files`. Unique par serveur seulement : un Add-on bootstrappe
   * le même (`boutique_shop`) sur chaque serveur qui l'installe. Diffère de
   * `id` (unique plateforme) quand un autre serveur détenait déjà cet id
   * disque. Absent = identique à `id`.
   */
  diskId?: string;
  name: string;
  description?: string;
  source: ProjectSource;
  sourceProjectId?: ProjectId;
  sourceVersion?: string;
  serverKeyId?: string;
  createdAt: string;
  updatedAt: string;
  menus: Menu[];
  commands: Command[];
  /** Captured items — serialized game ItemStacks + display descriptors (optional on older projects). */
  capturedItems?: CapturedItem[];
  assets: Asset[];
  dataSources: DataSource[];
  /** Declared data shapes for Project sources (optional: absent on older stored projects = []). */
  dataModels?: DataModel[];
  /**
   * @deprecated Dead since 2026-07-17 — the early "import connector YAML" flow
   * was superseded by server-reported data sources (+ snapshots + module-local
   * rows). Field kept optional so previously stored projects still parse;
   * nothing reads or writes it anymore.
   */
  importedConnectors?: ConnectorSpec[];
  i18nKeys: Record<I18nKey, Record<string, string>>;
  defaultLang: string;
  /**
   * How texts land on disk (ADR `files-first-source-of-truth` §4). `extract`
   * (default, and what absent means) keeps `{i18n:key}` refs in the documents
   * with every language in `lang/`; `inline` writes the default language's
   * literal where it is read and keeps only the other languages in `lang/`,
   * addressed by key site. Editor-only choice, persisted in
   * `.artisan/editor.yaml` — both shapes are valid input for the plugin.
   */
  i18nMode?: "extract" | "inline";
  dialogs: Dialog[];
  canvasLayout: Record<MenuId | CommandId | DialogId, { x: number; y: number }>;
  /**
   * Manual edge-endpoint overrides, keyed by edge id ("source->target").
   * Editor-only metadata — exported as manifest `editor_edges`.
   */
  canvasEdges?: Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }>;
  /**
   * Per-module opaque state, keyed by module id (e.g. "boutique"). Owned by
   * the module's editor package; the host never interprets it. Round-trips
   * through editorJson. Modules derive their exportFiles() output from here.
   * Backend file-import seeds `{ __files: Record<relPath, content> }` for
   * unrecognized project dirs; modules normalize that on first read.
   */
  moduleData?: Record<string, unknown>;
  /**
   * Owning Add-on module id (from `manifest.module`) when this is an Add-on's
   * dedicated project — drives the sidebar "Installed modules" grouping and is
   * round-tripped through the manifest (ADR `addon-owned-project-roots`).
   */
  ownerModule?: string;
}

/** Container shape of a menu. Absent in stored data = "chest" (back-compat). */
export type InventoryType = "chest" | "hopper" | "dropper";

export interface Menu {
  id: MenuId;
  projectId: ProjectId;
  title: MenuTitleLayer[];
  rows: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Container shape. Absent = "chest" everywhere (back-compat). `rows` is only
   * meaningful for chest; hopper/dropper have fixed geometry (see INVENTORY_TYPES).
   */
  inventoryType?: InventoryType;
  permission?: string;
  /**
   * Internal admin notes, never rendered to players (menu/v1 `notes`).
   * The AI assistant records non-mappable source constructs here on import.
   */
  notes?: string;
  layers: Layer[];
  /**
   * Named values the menu expects when opened — typically passed by the
   * caller (a command, or a parent menu's `open_menu` action). Inside the
   * menu, every Element's title/lore/click actions can reference these
   * via `{name}` placeholders.
   */
  contextInputs?: ContextInput[];
}

export type ContextInput =
  | {
      kind: "primitive";
      name: string;
      /** `list`/`object` = caller-provided structured data (e.g. an iteration alias). */
      type: "player" | "string" | "integer" | "number" | "boolean" | "list" | "object";
      /**
       * For `object`/`list`: the data source whose ROW MODEL this input carries
       * (caller-provided — NOT fetched, unlike `kind: "sourceRef"`). Gives the
       * editor the field schema: placeholder completion, preview candidates,
       * and the "Category (boutique:categories)" typed entry in the UI.
       */
      rowOf?: SourceRef;
      default?: string;
    }
  | {
      kind: "sourceRef";
      name: string;
      ref: SourceRef;
      /** ConnectorBinding extras (menu/v1 `source.*`) — carried opaquely so imports round-trip. */
      params?: Record<string, string>;
      filter?: Record<string, string>;
      sort?: { by: string; direction?: "asc" | "desc" };
      limit?: number;
    };

export interface Layer {
  id: LayerId;
  name: string;
  elements: Element[];
}

export interface Element {
  id: ElementId;
  positions: string;
  appearances: Appearance[];
  tags?: string[];
  /**
   * Iteration: when set, this element is rendered once per item of the
   * source list (a placeholder pointing to a list-typed value in the
   * menu's context, e.g. `quests`). Each iteration's `alias` (e.g.
   * `quest`) becomes a placeholder available inside this element's
   * title / lore / click actions, scoped to the current item.
   */
  iterates?: {
    source: string;
    alias: string;
  };
  /**
   * Placement mode (mutually exclusive with `iterates`): instead of auto-filling
   * a slot range in source order, the admin pins specific rows of a **static**
   * data source (matched by `keyField`) to explicit page+slot. Rows not placed are
   * omitted. How a row looks and behaves comes from this element's own
   * `appearances` — a Placement pins position only, no per-item override. Only
   * valid on static sources.
   */
  places?: {
    source: string;
    alias: string;
    /** The static source's Row key field — rows are matched to placements by this. */
    keyField: string;
    placements: Placement[];
  };
}

/** One pinned row of a static source at a hand-authored page+slot. */
export interface Placement {
  key: string;
  page: number;
  position: number;
  /**
   * Last-known display of the placed row, so the slot still renders offline / for
   * a member without the server connected. The live source wins when reachable.
   */
  cachedDisplay?: { name?: string; material?: string; lore?: string[] };
}

export interface Appearance {
  if?: Condition[];
  /** Per-joiner ops between consecutive `if` conditions. Defaults to "and". */
  ifJoins?: ("and" | "or")[];
  assetId?: AssetId;
  material?: string;
  /** Custom head when material is PLAYER_HEAD: "hdb:<id>", "basehead:<base64>", or "playerhead:<name>". */
  head?: string;
  count?: number;
  title?: LText;
  lore?: LText | null;
  click?: ClickMap;
  // ── advanced details (see domain/itemAdvanced.ts for the wire form) ───────
  enchants?: ItemEnchant[];
  /** Glint with no real enchantment. Redundant — and dropped — when `enchants` is set. */
  enchanted?: boolean;
  customModelData?: string;
  unbreakable?: boolean;
  /** Tooltip sections hidden from the player. */
  hide?: ItemHideFlag[];
  /** `#rrggbb` tint — leather armor, potions, firework stars. */
  color?: string;
  /** Raw SNBT escape hatch, applied last by the plugin. */
  nbt?: string;
}

export type ClickType = "left" | "right" | "shift_left" | "shift_right" | "middle";
export type ClickMap = Partial<Record<ClickType, ClickHandler>>;

/**
 * Click handler is a sequential list of `Step`s. Each step is either a
 * leaf action or an `if`-branch with one or more cases (the if/else-if
 * list) and an optional else-branch. This recursive shape lets the user
 * compose chains with arbitrary branching, which is what real Minecraft
 * GUI plugins actually need.
 */
export interface ClickHandler {
  steps: Step[];
}

export type Step =
  | { kind: "action"; action: Action }
  | { kind: "if"; cases: IfCase[]; else?: Step[] };

/**
 * One arm of an if/else-if chain.
 *
 *   joins[i] is the boolean operator between conditions[i] and
 *   conditions[i+1]. Length is `max(0, conditions.length - 1)`. Missing
 *   entries default to "and".
 *
 *   Standard precedence at runtime: AND binds tighter than OR. So
 *   `A AND B OR C AND D` evaluates as `(A AND B) OR (C AND D)`.
 *
 * For unary negation use `Condition` of type `not`. Composite AND/OR
 * conditions also exist for explicit grouping when precedence isn't enough.
 */
export interface IfCase {
  conditions: Condition[];
  joins?: ("and" | "or")[];
  steps: Step[];
}

export type Action =
  | {
      type: "open_menu";
      menuId: MenuId;
      clearContext?: boolean;
      /**
       * Values passed to the target menu's contextInputs when it opens.
       * Keys are the target input names; values are template strings
       * that may reference placeholders from the caller scope (e.g.
       * `{player}`, `{quest.name}`).
       */
      context?: Record<string, string>;
    }
  | { type: "close_menu" }
  | { type: "run_command"; command: string; as: "player" | "console" }
  | { type: "send_message"; text: LText }
  /**
   * Display a Minecraft HUD title (and optional subtitle) to the
   * triggering player. Mirrors Adventure's `Audience.showTitle(Title)`.
   * `title` and `subtitle` are LText refs so they translate per-player;
   * timings are ticks (50ms each). Defaults match Adventure: 10/70/20.
   */
  | {
      type: "show_title";
      title: LText;
      subtitle?: LText;
      fadeIn?: number;
      stay?: number;
      fadeOut?: number;
    }
  | { type: "give_item"; material: string; count: number }
  | { type: "take_item"; material: string; count: number }
  | { type: "take_money"; amount: number }
  | { type: "give_money"; amount: number }
  | { type: "give_xp"; amount: number }
  | { type: "give_level"; amount: number }
  /** Broadcast to every online player (vs send_message → triggering player only). */
  | { type: "broadcast"; text: LText }
  /** Play a sound to the triggering player. `sound` is a Bukkit Sound name. */
  | { type: "play_sound"; sound: string; volume?: number; pitch?: number }
  /** Teleport to coordinates. */
  | { type: "teleport"; world: string; x: number; y: number; z: number; yaw?: number; pitch?: number }
  /**
   * Advance pagination of an iterating element. If `targetElementId` is
   * unset the runtime paginates every iterating element in the current
   * menu (handy for a single "Next page" button when there's only one
   * list). With it set, only that element's pagination flips — useful
   * when a menu has several iterables, each with its own pager.
   */
  | { type: "paginate"; direction: "next" | "prev"; targetElementId?: ElementId }
  /**
   * Mutate a context input of the current menu. `value` is an Expression
   * (DSL). After the mutation, the runtime triggers a re-render of the
   * current menu. `arg` MUST match an existing Menu.contextInputs[*].name.
   */
  | { type: "set_arg"; arg: string; value: string }
  /**
   * Cycle a context input through a list. `list` is an Expression
   * evaluating to a list. The runtime finds the current value's index
   * (looseEq), advances by ±1 wrapping at endpoints, and writes the
   * new value to contextInput[arg]. Then triggers re-render.
   *
   * If `arg` is unknown or `list` doesn't evaluate to a non-empty list,
   * the action is a no-op (warn-logged).
   */
  | { type: "set_arg_cycle_next"; arg: string; list: string }
  | { type: "set_arg_cycle_prev"; arg: string; list: string }
  | {
      type: "open_dialog";
      dialogId: DialogId;
      context?: Record<string, string>;
      clearContext?: boolean;
    }
  | { type: "close_dialog" }
  /**
   * Invoke an Action chain stored on a Data source `actions` field. `actions`
   * is an Expression resolving to the chain (a table row's field or a config
   * value); it runs inline with the resolved-from object as self-scope, depth
   * capped at 16. Cf. ADR `action-dsl`.
   */
  | { type: "run_actions"; actions: string };

export type Condition =
  | { type: "has_permission"; perm: string }
  | { type: "has_money"; amount: number }
  /**
   * Compare a placeholder to a literal value. The placeholder string can
   * reference a contextInput ({category}), an iteration field
   * ({alias.field}), or a PAPI placeholder (%vault_eco_balance%).
   */
  | { type: "placeholder_equals"; placeholder: string; value: string }
  /**
   * Match a placeholder against a regex. Same placeholder semantics as
   * placeholder_equals.
   */
  | { type: "placeholder_match"; placeholder: string; regex: string }
  // The following mirror the wire shape exactly (snake_case fields) — the
  // exporter passes conditions through as-is, so domain = menu/v1 here.
  | { type: "has_item"; material: string; count: number }
  | { type: "has_xp"; amount: number }
  | { type: "has_level"; level: number }
  | { type: "world_is"; world: string }
  | { type: "time_is"; range: "day" | "night" | { from_ticks: number; to_ticks: number } }
  | { type: "random_chance"; probability: number }
  | { type: "cooldown_passed"; cooldown_id: string }
  | { type: "player_in_region"; region: string }
  | { type: "pagination_at_first"; elementId?: string }
  | { type: "pagination_at_last"; elementId?: string }
  | { type: "not"; of: Condition }
  | { type: "and"; of: Condition[] }
  | { type: "or"; of: Condition[] }
  /**
   * Free-form boolean expression evaluated via the DSL (cf.
   * web/src/lib/expr/). Used when typed conditions don't fit, e.g.
   * comparisons with operators other than == or against runtime
   * iteration fields.
   */
  | { type: "expression"; expr: string };

export interface Command {
  id: CommandId;
  projectId: ProjectId;
  name: string;
  aliases?: string[];
  permission?: string;
  description?: string;
  arguments: CommandArg[];
  steps: Step[];
}

export interface CommandArg {
  name: string;
  type: "player" | "string" | "integer" | "number" | "boolean";
  required: boolean;
  /**
   * Reserved value `"{sender}"` on a `player` argument: omitted → bind whoever
   * typed the command (the editor's "sender" checkbox).
   */
  default?: string;
}

/**
 * A full serialized ItemStack captured from the running game (inventory mirror
 * or an in-game command), plus a display descriptor derived generically at
 * capture time. The universal item value: referenced anywhere a material goes
 * through the `item:<id>` ref — the editor renders `display`, the plugin
 * deserializes `stackYaml` (exact NBT fidelity). Cf. ADR
 * `captured-items-and-module-field-kit` + CONTEXT.md "Captured item".
 */
export interface CapturedItem {
  id: CapturedItemId;
  /** Admin-facing label (defaults to the stack's display name at capture). */
  name: string;
  /** Opaque Bukkit-serialized stack — runtime truth, never interpreted here. */
  stackYaml: string;
  /** Derived once at capture, from vanilla components (no per-plugin branch). */
  display: {
    /** Base material, possibly enriched to a recognized custom ref (nexo:…). */
    material?: string;
    /** base64 head texture when the stack is a player head with a profile. */
    headTexture?: string;
    enchanted?: boolean;
    count?: number;
    /** The stack's own display name (item_name/custom_name), plain text. */
    name?: string;
  };
}

export interface Asset {
  id: AssetId;
  projectId: ProjectId;
  name: string;
  url: string;
  width: number;
  height: number;
}

/**
 * Recursive type descriptor for a data source's shape. Discriminated by
 * `kind`. Primitives (string/number/integer/boolean) are leaves.
 * `list` and `object` recurse — `list of {kind: object, fields: [...]}` is
 * the canonical "list of records" shape used by most connectors.
 */
export type FieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "list"; of: FieldType }
  | { kind: "object"; fields: { name: string; type: FieldType }[] };

/**
 * Recursive **declared** field type for Project-source content. Unlike the
 * inferred {@link FieldType} (kept for module-reported schemas), this is what
 * the admin authors in the Data model form. Extra leaves:
 *  - `ltext` — a localizable string; the stored value is an {@link LText}
 *    (key into `Project.i18nKeys`), a normal Key site.
 *  - `minimessage` / `minimessage_multiline` — plain strings holding
 *    MiniMessage markup; editor-only editing affordance (rendered facade,
 *    raw source on focus), **exported as `string`** — data/v1 never sees it.
 *  - `item`  — the material value-space (`"DIAMOND"`, `item:<id>`, custom ref).
 *  - `actions` — an Action chain, stored as an **Action DSL** string (the
 *    hand-writable text serialization of `Step[]`); exported verbatim. Cf. ADR
 *    `action-dsl`.
 * `model` references another {@link DataModel} by id (no cycles — guarded at
 * edit time by `wouldCreateModelCycle`).
 * Cf. ADR `project-sources-and-data-models` + CONTEXT.md "Data model".
 */
export type ModelFieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "ltext" }
  | { kind: "minimessage" }
  | { kind: "minimessage_multiline" }
  | { kind: "item" }
  | { kind: "actions" }
  | { kind: "list"; of: ModelFieldType }
  | { kind: "object"; fields: ModelField[] }
  | { kind: "model"; ref: DataModelId }
  // Composable kinds (ADR composable-data-models):
  /** Dictionary — string key → value of `of`. */
  | { kind: "map"; of: ModelFieldType }
  /** Closed value set; the stored value is one of `values` (a plain string). */
  | { kind: "enum"; values: string[] }
  /**
   * Discriminated union: the value is an object carrying `[tag]: <variant
   * name>` plus that variant's fields. Data variants only — behavioural
   * vocabulary stays on the core `actions`/`conditions` kinds.
   */
  | { kind: "union"; tag: string; variants: UnionVariant[] }
  /**
   * Core condition vocabulary (ADR composable-data-models §6): the value is
   * the wire-shaped Condition[] the menu engine evaluates — a Module never
   * declares its own condition variants. Exported verbatim; the runtime side
   * treats it as opaque until evaluated through the core engine.
   */
  | { kind: "conditions" };

export interface UnionVariant {
  /** The tag value selecting this variant. */
  name: string;
  fields: ModelField[];
}

export interface ModelField {
  name: string;
  type: ModelFieldType;
  // ── presentation hints (ADR composable-data-models §7) — closed set, part
  // of the declaration (same owner as the shape), invisible to the runtime.
  /** Display label in the generated form (fallback: the field name). */
  label?: string;
  /** Help text shown as a tooltip. */
  help?: string;
  /** Section header the field is grouped under. */
  section?: string;
  // ── validation vocabulary (§7) — asymmetric enforcement: blocking inside
  // the generated form, surfaced-never-blocking for hand-edited files.
  required?: boolean;
  /** Prefill for fresh instances AND the `set_default` migration value. */
  default?: unknown;
  /** Numeric bounds (number/integer kinds). */
  min?: number;
  max?: number;
  /** Regex the string value must match (string-like kinds). */
  pattern?: string;
  /** The Add-on manages this value itself — read-only in the form. */
  locked?: boolean;
}

/**
 * Project-level **named shape of data** — the admin-declared schema that
 * Project-source content conforms to. Every Table source is a table *of* one
 * Data model (auto-created with it); the **Row key** is declared here, so two
 * Tables of the same model share it. Editor-side only: denormalized into each
 * `data/<id>.yaml` at export — the Bundle/plugin never see model identity.
 * Cf. CONTEXT.md "Data model".
 */
export interface DataModel {
  id: DataModelId;
  name: string;
  fields: ModelField[];
  /** Name of the top-level scalar field acting as Row key. */
  keyField: string;
  /**
   * "module" = declared by an Add-on at Presence (namespaced id, shape
   * read-only for the admin, never emitted to models/). Absent =
   * project-authored (ADR composable-data-models §1/§4).
   */
  provenance?: "module";
  /** Monotonic declaration version (module-declared models). */
  version?: number;
  /** Declarative migration steps shipped with the declaration (§5). */
  migrations?: import("./modelMigrations").ModelMigration[];
  /**
   * Presentation hint (§7): render this model's Table as master-detail — a
   * row list (master) beside the selected row's form (detail) — instead of
   * the spreadsheet. The boutique catalog pattern.
   */
  masterDetail?: boolean;
}

/**
 * **Project source** — admin-authored data living on the Project, referenced
 * by menus via `ContextInput { kind: "sourceRef", ref: "pack:<id>" }`. Always
 * static. Two shapes (cf. ADR `project-sources-and-data-models`):
 *  - `table`  — rows of one {@link DataModel}; iterable, placeable, Set target.
 *  - `config` — a single object for interpolation (settings/constants); its
 *    inline fields may reference Data models.
 * ltext field values are stored as {@link LText} nodes; item values as
 * material/`item:<id>` refs.
 */
export type DataSource =
  | {
      id: DataSourceId;
      name: string;
      shape: "table";
      modelId: DataModelId;
      /**
       * File granularity (ADR composable-data-models §2): absent = the whole
       * table in one `data/<id>.yaml`; `"row"` = a `data/<id>/` directory with
       * `_source.yaml` (meta + fields + row order) and one file per row named
       * by the Row key. Serialization only — consumers are blind to it.
       */
      granularity?: "row";
      /**
       * Declared-model version this table's rows were last written under
       * (round-tripped as `model_version` in data/v1). The loader applies the
       * declaration's migration chain when it lags the declared version.
       */
      modelVersion?: number;
      rows: Record<string, unknown>[];
      /**
       * Hand-written leading comment block of the data file (ADR
       * bare-data-files ⑦) — captured at import, re-emitted verbatim before
       * the generated hint block.
       */
      headerComment?: string;
    }
  | {
      id: DataSourceId;
      name: string;
      shape: "config";
      fields: ModelField[];
      value: Record<string, unknown>;
      /**
       * Module-declared model this config is typed by (ADR
       * `yaml-assisted-editing`). The schema arrives via Presence, so `fields`
       * is empty until injection; on disk the beside file holds a one-line
       * `model:` ref, never a copy of the declaration.
       */
      modelId?: DataModelId;
      /** Hand-written leading comment block (ADR bare-data-files ⑦). */
      headerComment?: string;
    };

/**
 * Spec of a plugin-sourced connector. Either pushed to the editor via
 * WS at server connection (plan paid) or manually imported from a YAML
 * file generated by the Artisan plugin (plan free). Stored on the
 * project so exports ship with their connector specs.
 */
export interface ConnectorSpec {
  /** Stable namespaced ref, e.g. "chestshop:items", "essentials:warps". */
  ref: string;
  type: FieldType;
  /** 3-5 sample items validated against `type`. */
  sample: unknown;
}

export interface Dialog {
  id: DialogId;
  projectId: ProjectId;
  title: LText;
  canCloseWithEscape: boolean;
  body: DialogBody[];
  inputs: DialogInput[];
  buttons: DialogButton[];
}

export type DialogBody =
  | { type: "text"; text: LText }
  | { type: "item"; material: string; count: number };

export type DialogInput =
  | { type: "text"; id: string; label: LText; default: string; maxLength: number }
  | { type: "bool"; id: string; label: LText; default: boolean }
  | {
      type: "number_range";
      id: string;
      label: LText;
      min: number;
      max: number;
      default: number;
    }
  | {
      type: "single_option";
      id: string;
      label: LText;
      options: DialogOption[];
      default: string;
    };

export interface DialogOption {
  value: string;
  label: LText;
}

export interface DialogButton {
  id: string;
  label: LText;
  steps: Step[];
}
