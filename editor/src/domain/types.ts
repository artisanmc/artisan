/**
 * Domain types for the Artisan editor scaffold.
 *
 * - References (open_menu, template_ref, i18n key) may dangle: a target id
 *   that doesn't resolve at runtime is a no-op (or the plugin surfaces an
 *   error to the player). The editor doesn't enforce hermeticity — packs
 *   can freely reference each other or have stale ids.
 * - "Element" is the canonical name (per main-spec §8.1); the old "Slot" name
 *   from the prior proto is dropped.
 */

export type AccountId = string & { __brand: "AccountId" };
export type ProjectId = string & { __brand: "ProjectId" };
export type MenuId = string & { __brand: "MenuId" };
export type CommandId = string & { __brand: "CommandId" };
export type TemplateId = string & { __brand: "TemplateId" };
export type ItemTemplateId = string & { __brand: "ItemTemplateId" };
export type CapturedItemId = string & { __brand: "CapturedItemId" };
export type AssetId = string & { __brand: "AssetId" };
export type ElementId = string & { __brand: "ElementId" };
export type LayerId = string & { __brand: "LayerId" };
export type I18nKey = string & { __brand: "I18nKey" };
export type DataSourceId = string & { __brand: "DataSourceId" };
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
  /** Plain vanilla title — no resource pack required. Emitted as a raw
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
  templates: Template[];
  /** Item templates — named per-source row views (optional: absent on older stored projects = []). */
  itemTemplates?: ItemTemplate[];
  /** Captured items — serialized game ItemStacks + display descriptors (optional on older projects). */
  capturedItems?: CapturedItem[];
  assets: Asset[];
  dataSources: DataSource[];
  /**
   * @deprecated Dead since 2026-07-17 — the early "import connector YAML" flow
   * was superseded by server-reported data sources (+ snapshots + module-local
   * rows). Field kept optional so previously stored projects still parse;
   * nothing reads or writes it anymore.
   */
  importedConnectors?: ConnectorSpec[];
  i18nKeys: Record<I18nKey, Record<string, string>>;
  defaultLang: string;
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
  templateRef?: { id: TemplateId; vars: Record<string, string> };
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
    /** Item template this pagination renders through. When set, the template wins
     *  for alias + appearances (inlined at export); absent = local appearances. */
    templateId?: ItemTemplateId;
  };
  /**
   * Placement mode (mutually exclusive with `iterates`): instead of auto-filling
   * a slot range in source order, the admin pins specific rows of a **static**
   * data source (matched by `keyField`) to explicit page+slot. Rows not placed are
   * omitted. How a row looks and behaves comes from the bound Item template
   * (`templateId`) — a Placement pins position only, no per-item override. Only
   * valid on static sources.
   */
  places?: {
    source: string;
    alias: string;
    /** The static source's Row key field — rows are matched to placements by this. */
    keyField: string;
    /** Item template rows render through. When set, wins for alias/keyField/
     *  appearances (inlined at export); local fields are the dangling fallback. */
    templateId?: ItemTemplateId;
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
  | { type: "close_dialog" };

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
  default?: string;
}

export interface Template {
  id: TemplateId;
  projectId: ProjectId;
  name: string;
  variables: { name: string; type: string }[];
  appearances: Appearance[];
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

/**
 * Project-level **named view over one data source**: how one row of that source
 * renders as a menu slot — appearances (material/title/lore/count) **and click
 * behaviour** — with per-row variation via conditional appearance states (never
 * per-item overrides). Consumed by elements through `iterates.templateId` /
 * `places.templateId`; **inlined at export**, so menu/v1 and the plugin never see
 * templates. N templates per source; one template per (menu, source).
 * Cf. ADR `item-templates-and-data-library` + CONTEXT.md "Item template".
 */
export interface ItemTemplate {
  id: ItemTemplateId;
  projectId: ProjectId;
  name: string;
  /** Data source ref this template renders (e.g. "boutique:items"). */
  sourceRef: string;
  /** Placeholder alias rows bind to in appearances (e.g. "item" → `{item.name}`). */
  alias: string;
  /** Static source's Row key — needed to place; absent for dynamic sources. */
  keyField?: string;
  /** Library grouping field (static only). Pure arrangement — zero runtime effect. */
  groupBy?: string;
  /** THE row template. Conditional states (`if` on row fields) express variation. */
  appearances: Appearance[];
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
 * Admin-made source of typed data. Lives on the pack and is referenced
 * by menus via `ContextInput { kind: "sourceRef", ref: "pack:<id>" }`.
 * Renaming the source updates referencing inputs atomically (cf.
 * accountStore reducers in Plan C2).
 */
export interface DataSource {
  id: DataSourceId;
  name: string;
  type: FieldType;
  /**
   * Concrete data, validated against `type` at edit time. Stored as
   * unknown because the shape varies — runtime/preview consumers cast
   * after schema lookup.
   */
  value: unknown;
}

/**
 * Spec of a plugin-sourced connector. Either pushed to the editor via
 * WS at server connection (plan paid) or manually imported from a YAML
 * file generated by the Artisan plugin (plan free). Stored on the
 * pack so exports ship with their connector specs.
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
