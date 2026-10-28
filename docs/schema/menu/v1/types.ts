/**
 * Artisan — Menu schema v1 — TypeScript types
 *
 * Source of truth for a menu's intermediate format.
 * Maintained by hand, mirroring schema.json. The two MUST stay in sync.
 *
 * Vocabulary:
 *   - "position"     : Minecraft position in the inventory (0-53). What the game calls a "slot".
 *   - "Element"      : Artisan object (button, decoration, paginated list, data grid...) that occupies one or more positions.
 *   - "Layer"        : container that groups thematically related Elements.
 *                      Ordered bottom→top in Menu.layers; render walks top→bottom with natural fall-through.
 *   - "Appearance"   : visual variant of an Element. Evaluated in order, the first whose `if` matches wins.
 *                      No partial override — each Appearance is complete and self-sufficient.
 *   - "ContextInput" : named, typed slot that the menu declares via Menu.contextInputs. Populated on open
 *                      by auto-binding by name (from the caller) or via an attached ConnectorBinding.
 *                      Exposed as {name} in the menu's fields. See main-spec §14, §15.4.
 *   - "ConnectorBinding" : reference (consumer side) to a data source (homemade Artisan or registered by a third-party plugin in V2)
 *                          that exposes a typed list/object. Attached to a ContextInput via `source`. Elements
 *                          iterate via `iterates: { source: <input_name>, alias }` and access the fields
 *                          of the current item via {alias.field}.
 */

// ============================================================================
// TOP-LEVEL
// ============================================================================

export interface Menu {
  schema: "menu/v1";
  id: string;
  /** Title layers, ordered. Empty = no title. Pixel-perfect format (offsets, fonts) documented in editor-internals.md. */
  title: MenuTitleLayer[];
  size: 9 | 18 | 27 | 36 | 45 | 54;
  /** Bottom of the window. Absent = "visible" (real inventory, positions ≥ size ignored). "hidden": positions size..size+35 = player slots (rawSlot). */
  player_inventory?: "visible" | "hidden";
  /** Absent/true = vanilla texture. false: transparent window (chest, hopper, dropper), see schema.json. */
  vanilla_texture?: boolean;
  permission?: string;
  /** Internal admin notes (never shown to players). Round-trip-safe JSON ↔ YAML. */
  notes?: string;
  /** Default appearance of positions not covered by a visible Element (ultimate fall-through). */
  background?: Appearance;
  /** Named slots the menu exposes. Populated on open by auto-binding by name (see main-spec §15.4) or by a ConnectorBinding (see §14). Referenced via {name} in any text field of the menu. */
  context_inputs?: ContextInput[];
  open_requirements?: Condition[];
  /** Action chains as Action DSL strings (cf. ADR `action-dsl`). */
  open_actions?: string;
  close_actions?: string;
  layers: Layer[];
  metadata?: MenuMetadata;
}

// ============================================================================
// TITLE LAYERS
// ============================================================================

/**
 * A structural slot text (ADR `field-local-translations`): either a string
 * (`'{i18n:key}'` or literal, identical for all languages), or a field-local
 * map `{ lang: text }` resolved requested language → defaultLang → default.
 */
export type LText = string | Record<string, string>;

/** Lore: a list of lines, or a list of lines per language (`{ en: [...], fr: [...] }`). */
export type Lore = LText[] | Record<string, string[]>;

/** Allowed font size for text/textarea title layers. */
export type TitleFontSize = 8 | 12 | 16 | 20 | 24 | 32;

/**
 * Title layer. Pixel-perfect format (pixel offsets, custom fonts) documented
 * in editor-internals.md. A menu's title is an ordered array of these layers.
 */
export type MenuTitleLayer =
  | { kind: "background"; asset_id: string }
  | { kind: "glyph"; asset_id: string; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number; color?: string; font_asset_id?: string; size?: TitleFontSize }
  | { kind: "plain"; value: LText; color?: string }
  | {
      kind: "textarea";
      value: LText;
      x: number;
      y: number;
      width: number;
      line_height: number;
      alignment: "left" | "center" | "right";
      font_asset_id?: string;
      size?: TitleFontSize;
    }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder"; glyph_name: string; x: number; y: number };

// ============================================================================
// CONTEXT INPUTS
// ============================================================================

export interface ContextInput {
  /** Slug exposed as {name} in the menu's fields. Unique within the menu. */
  name: string;
  type: "player" | "string" | "integer" | "number" | "boolean" | "list" | "object";
  /** Fallback value if the caller passes nothing and no data source is attached. Supports placeholders. */
  default?: string;
  /** If present, the slot's value is fetched by a data source instead of being passed by the caller. Valid only on type="list" or type="object". */
  source?: ConnectorBinding;
}

export interface ConnectorBinding {
  /** "namespace:source", e.g. "chestshop:items", "essentials:warps", "jobs:list". */
  ref: string;
  /** Parameters passed to the data source (vary per data source). Support {name} to interpolate the menu's other contextInputs. */
  params?: Record<string, string>;
  /** Filters applied on the data's fields before render. Support {name} to interpolate the other contextInputs. E.g. { category: "{category}" } to filter by the value of the "category" input. */
  filter?: Record<string, string>;
  sort?: { by: string; direction?: "asc" | "desc" };
  /** Default = number of positions of the Element iterating this slot. Max 1000. */
  limit?: number;
}

export interface MenuMetadata {
  uses_plugins?: string[];
  created_at?: string;
  updated_at?: string;
  author?: string;
  [key: string]: unknown;
}

// ============================================================================
// LAYER
// ============================================================================

export interface Layer {
  /** Stable slug, unique within the menu. */
  id: string;
  /** Name shown in the editor's layer panel. */
  name: string;
  /** Internal admin notes (never shown to players). */
  notes?: string;
  /** Elements in this layer. Last-placed-wins on overlap. */
  elements: Element[];
}

// ============================================================================
// ELEMENT
// ============================================================================

/**
 * An Element: its structural keys, plus — FLAT — the fields of its
 * **display**, the appearance rendered when no state applies. Hence
 * the extension of `Appearance`: at the top level of an Element, everything that is
 * not structural is a display field.
 */
export interface Element extends Appearance {
  /** Stable identifier, unique within the menu (across all layers). */
  id: string;
  /** "15" for a single position, "10-43" for a range. */
  positions: string;
  /**
   * Guarded states, tried in order BEFORE the display. The first whose `if`
   * passes wins; if none passes, the display is rendered. A state is a
   * WHOLE appearance, not a patch: what it does not write is absent, never
   * inherited from the display (ADR `element-display-and-states`).
   */
  states?: Appearance[];
  /**
   * If present, the Element becomes iterative: for each item of the contextInput named `source`
   * (of type "list"), the engine evaluates its appearances with the current item exposed as `alias`,
   * accessible via {alias.field}. The source list can come from the caller or from a data source —
   * transparent to the Element. Mutually exclusive with component_ref in an appearance.
   */
  iterates?: { source: string; alias: string };
  template_ref?: TemplateRef | null;
  tags?: string[];
}

export interface Appearance {
  image?: import("./imageButtonGeometry").ImageButtonImage;
  /** ANDed conditions. If absent, always matches (fallback, put it last). */
  if?: Condition[];
  asset?: string;
  /** Literal "DIAMOND", {input_name} for a contextInput, or {alias.field} in an iterating Element. */
  material?: string;
  /**
   * Reference or expression of a full item: quantity and metadata are inherited
   * from the designated item, then overridden by the explicit presentation fields.
   * Mutually exclusive with `material`.
   */
  item?: string;
  /** Custom head: hdb:<id>, basehead:<base64>, or playerhead:<name>. Ignored if material ≠ PLAYER_HEAD. */
  head?: string;
  count?: number;
  title?: LText;
  /** Lines, or a list of lines per language (canonical translated form). */
  lore?: Lore;
  /** `replace`: this lore DISCARDS the base item's. Absent = it is added to it (default); write `{base.lore}` to position it yourself. */
  lore_mode?: "replace";
  /** Map id → level ({ sharpness: 5 }); the list form is read but never written. */
  enchants?: Record<string, number> | { id: string; level?: number }[];
  /** Glint effect without a real enchantment. Redundant when `enchants` is present. */
  enchanted?: boolean;
  custom_model_data?: string;
  unbreakable?: boolean;
  /** Hidden tooltip sections (Bukkit ItemFlag, short spelling). */
  hide?: (
    | "enchants"
    | "attributes"
    | "unbreakable"
    | "destroys"
    | "placed_on"
    | "additional"
    | "dye"
    | "armor_trim"
    | "stored_enchants"
  )[];
  /** #rrggbb tint — leather / potion / firework star. */
  color?: string;
  /** Raw SNBT applied last (escape hatch, best-effort). */
  nbt?: string;
  component_ref?: string;
  click?: ClickMap | null;
  /** Internal admin notes (never shown to players). */
  notes?: string;
}

export interface TemplateRef {
  id: string;
  vars?: Record<string, unknown>;
  overrides?: Partial<Appearance>;
}

// ============================================================================
// CLICK
// ============================================================================

export interface ClickMap {
  left?: ClickHandler;
  right?: ClickHandler;
  shift_left?: ClickHandler;
  shift_right?: ClickHandler;
  middle?: ClickHandler;
}

/**
 * An action chain (ADR `structured-action-wire`). Canonical wire: a
 * **list of structured steps** (or a single step). A **string** = old
 * Action DSL (legacy, read and rewritten as structured); `{ steps: string }` = wrapped
 * legacy form.
 *
 * A step = an action without arguments (bare string), an action `{ <name>: args }`,
 * or an `{ if, do, else }` block. The actions' text is an {@link LText}.
 */
export type ClickHandler =
  | string
  | StructuredStep
  | StructuredStep[]
  | { steps: string };

export type StructuredStep =
  | string
  | StructuredAction
  | { if: StructuredCondition[]; do: StructuredStep[]; else?: StructuredStep[] };

/** Action = single-key map: `{ <name>: args }` (1 arg → value, several → map). */
export type StructuredAction = Record<string, unknown>;

/** Condition = single-key map: `{ <name>: args }` (`or:`/`and:` = list, `not:` = condition). */
export type StructuredCondition = Record<string, unknown>;

/** A conditional case in an `if` Step. */
export interface IfCase {
  conditions: Condition[];
  /** Join operators between conditions (all ANDed by default). */
  joins?: ("and" | "or")[];
  steps: Step[];
}

/** A step of a click handler: either an action or a conditional branch. */
export type Step =
  | { kind: "action"; action: Action }
  | { kind: "if"; cases: IfCase[]; else?: Step[] };

// ============================================================================
// ACTIONS (21)
// ============================================================================

export type Action =
  | RunCommandAction | OpenMenuAction | CloseMenuAction | OpenPreviousMenuAction
  | GiveItemAction | TakeItemAction
  | GiveMoneyAction | TakeMoneyAction
  | GiveXpAction | GiveLevelAction
  | SendMessageAction | BroadcastAction
  | PlaySoundAction | TeleportAction
  | PaginationNextAction | PaginationPrevAction
  | ShowTitleAction
  | OpenDialogAction | CloseDialogAction
  | SetArgAction | SetArgCycleNextAction | SetArgCyclePrevAction;

export interface RunCommandAction { type: "run_command"; command: string; as?: "player" | "console"; }
export interface OpenMenuAction   {
  type: "open_menu";
  menu_id: string;
  close_current?: boolean;
  /**
   * Explicit override of auto-binding by name (see main-spec §15.4). Each entry
   * populates a contextInput of the target menu; values support {name} to interpolate
   * the current scope (command args, the caller's contextInputs, iteration alias).
   */
  context?: Record<string, string>;
  /** Disables auto-binding by name (the `context` override stays active). */
  clear_context?: boolean;
}
export interface CloseMenuAction  { type: "close_menu"; }
/**
 * Reopens the previous screen from the player's navigation history (back
 * button). Consumes the history: menu → wiki → item, two backs return to the
 * menu (no item ↔ wiki back-and-forth). No-op without a previous screen; guard the
 * button with the `has_previous_menu` placeholder.
 */
export interface OpenPreviousMenuAction { type: "open_previous_menu"; }
export interface GiveItemAction   { type: "give_item"; material: string; count: number; nbt?: string; name?: string; lore?: LText[]; }
export interface TakeItemAction   { type: "take_item"; material: string; count: number; nbt?: string; }
export interface GiveMoneyAction  { type: "give_money"; amount: number; currency?: string; }
export interface TakeMoneyAction  { type: "take_money"; amount: number; currency?: string; }
export interface GiveXpAction     { type: "give_xp"; amount: number; }
export interface GiveLevelAction  { type: "give_level"; amount: number; }
export interface SendMessageAction { type: "send_message"; text: string; }
export interface BroadcastAction  { type: "broadcast"; text: string; }
export interface PlaySoundAction  { type: "play_sound"; sound: string; volume?: number; pitch?: number; }
export interface TeleportAction   { type: "teleport"; world?: string; x?: number; y?: number; z?: number; yaw?: number; pitch?: number; }
export interface PaginationNextAction { type: "pagination_next"; element_id?: string; }
export interface PaginationPrevAction { type: "pagination_prev"; element_id?: string; }
export interface ShowTitleAction  { type: "show_title"; title: string; subtitle?: string; fade_in?: number; stay?: number; fade_out?: number; }
export interface OpenDialogAction {
  type: "open_dialog";
  dialog_id: string;
  context?: Record<string, string>;
  clear_context?: boolean;
}
export interface CloseDialogAction { type: "close_dialog"; }
export interface SetArgAction          { type: "set_arg"; arg: string; value: string; }
export interface SetArgCycleNextAction { type: "set_arg_cycle_next"; arg: string; list: string; }
export interface SetArgCyclePrevAction { type: "set_arg_cycle_prev"; arg: string; list: string; }

// ============================================================================
// CONDITIONS (18)
// ============================================================================

export type Condition =
  | HasPermissionCondition | HasMoneyCondition | HasItemCondition
  | HasXpCondition | HasLevelCondition
  | PlaceholderEqualsCondition | PlaceholderMatchCondition
  | CooldownPassedCondition
  | WorldIsCondition | TimeIsCondition
  | RandomChanceCondition | PlayerInRegionCondition
  | PaginationAtFirstCondition | PaginationAtLastCondition
  | NotCondition | AndCondition | OrCondition
  | ExpressionCondition;

export interface HasPermissionCondition     { type: "has_permission"; perm: string; }
export interface HasMoneyCondition          { type: "has_money"; amount: number; currency?: string; }
export interface HasItemCondition           { type: "has_item"; material: string; count: number; nbt?: string; }
export interface HasXpCondition             { type: "has_xp"; amount: number; }
export interface HasLevelCondition          { type: "has_level"; level: number; }
/**
 * Compares a placeholder to a value. The placeholder can be a PAPI (%vault_eco_balance%),
 * a contextInput ({category}), or an iteration field ({shop.rarity}). Replaces the old
 * data_field_* conditions — use {alias.field} on an iterating Element.
 */
export interface PlaceholderEqualsCondition { type: "placeholder_equals"; placeholder: string; value: string; }
export interface PlaceholderMatchCondition  { type: "placeholder_match"; placeholder: string; regex: string; }
export interface CooldownPassedCondition    { type: "cooldown_passed"; cooldown_id: string; }
export interface WorldIsCondition           { type: "world_is"; world: string; }
export interface TimeIsCondition            { type: "time_is"; range: "day" | "night" | { from_ticks: number; to_ticks: number }; }
export interface RandomChanceCondition      { type: "random_chance"; probability: number; }
export interface PlayerInRegionCondition    { type: "player_in_region"; region: string; }
export interface PaginationAtFirstCondition { type: "pagination_at_first"; element_id?: string; }
export interface PaginationAtLastCondition  { type: "pagination_at_last"; element_id?: string; }
export interface NotCondition { type: "not"; of: Condition; }
export interface AndCondition { type: "and"; of: Condition[]; }
export interface OrCondition  { type: "or"; of: Condition[]; }
export interface ExpressionCondition { type: "expression"; expr: string; }

// ============================================================================
// TEMPLATES (stored separately)
// ============================================================================

export interface Template {
  schema: "template/v1";
  template_id: string;
  variables: TemplateVariable[];
  appearances: Appearance[];
}

export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean" | "material";
  default?: unknown;
}

// ============================================================================
// HELPERS
// ============================================================================

export const ACTION_TYPES = [
  "run_command", "open_menu", "close_menu", "open_previous_menu",
  "give_item", "take_item",
  "give_money", "take_money",
  "give_xp", "give_level",
  "send_message", "broadcast",
  "play_sound", "teleport",
  "pagination_next", "pagination_prev",
  "show_title",
  "open_dialog", "close_dialog",
  "set_arg", "set_arg_cycle_next", "set_arg_cycle_prev",
] as const satisfies ReadonlyArray<Action["type"]>;

export const CONDITION_TYPES = [
  "has_permission",
  "has_money", "has_item", "has_xp", "has_level",
  "placeholder_equals", "placeholder_match",
  "cooldown_passed",
  "world_is", "time_is",
  "random_chance", "player_in_region",
  "pagination_at_first", "pagination_at_last",
  "not", "and", "or",
  "expression",
] as const satisfies ReadonlyArray<Condition["type"]>;

export const CLICK_TYPES = ["left", "right", "shift_left", "shift_right", "middle"] as const;
export type ClickType = (typeof CLICK_TYPES)[number];

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/** Parses "15" or "10-43" into an inclusive [from, to] interval. Returns null if invalid. */
export function parsePositions(positions: string): { from: number; to: number } | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(positions);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] !== undefined ? Number(m[2]) : from;
  if (to < from) return null;
  return { from, to };
}

export function isRangeElement(element: Element): boolean {
  const r = parsePositions(element.positions);
  return r !== null && r.to > r.from;
}

export function isIterating(element: Element): boolean {
  return element.iterates !== undefined;
}

export interface LayoutCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Checks cross-layer unique ids + in-bounds positions + unique layer ids + iterates/component_ref consistency
 * + resolution of `iterates.source` against the contextInputs.
 * Intra-layer overlap = warning (last-placed-wins, not an error).
 * Cross-layer overlap = OK (intentional fall-through pattern).
 */
export function validateMenuLayout(menu: Pick<Menu, "size" | "layers" | "context_inputs" | "player_inventory">): LayoutCheck {
  const errors: string[] = [];
  // Addressable positions: the menu, plus the 36 player slots when the bottom is hidden.
  const limit = menu.size + (menu.player_inventory === "hidden" ? 36 : 0);
  const warnings: string[] = [];
  const seenElementIds = new Set<string>();
  const seenLayerIds = new Set<string>();
  const inputsByName = new Map<string, ContextInput>();
  for (const ci of menu.context_inputs ?? []) inputsByName.set(ci.name, ci);

  for (const layer of menu.layers) {
    if (seenLayerIds.has(layer.id)) {
      errors.push(`Layer id "${layer.id}" is duplicated.`);
    }
    seenLayerIds.add(layer.id);

    const occupiedInLayer = new Map<number, string>();
    for (const el of layer.elements) {
      if (seenElementIds.has(el.id)) {
        errors.push(`Element id "${el.id}" is duplicated.`);
      }
      seenElementIds.add(el.id);

      // iterates / component_ref mutex + iterates.source resolvable to a contextInput of type "list"
      if (el.iterates) {
        for (const app of [el, ...(el.states ?? [])]) {
          if (app.component_ref) {
            errors.push(`Element "${el.id}" mixes iterates and appearance.component_ref — incompatible.`);
            break;
          }
        }
        const input = inputsByName.get(el.iterates.source);
        if (!input) {
          errors.push(`Element "${el.id}" iterates.source "${el.iterates.source}" does not reference any contextInput.`);
        } else if (input.type !== "list") {
          errors.push(`Element "${el.id}" iterates.source "${el.iterates.source}" must be a contextInput of type "list" (currently "${input.type}").`);
        }
      }

      const ranges = String(el.positions).split(",").map(part => parsePositions(part.trim()));
      if (ranges.some(r => !r || !Number.isSafeInteger(r.from) || !Number.isSafeInteger(r.to))) {
        errors.push(`Element "${el.id}" has invalid positions "${el.positions}".`);
        continue;
      }
      const positions = new Set<number>();
      for (const r of ranges) {
        if (!r) continue;
        if (r.to >= limit) {
          errors.push(`Element "${el.id}" occupies position ${r.to} which is out of bounds (limit=${limit}).`);
        }
        for (let p = r.from; p <= Math.min(r.to, limit - 1); p++) positions.add(p);
      }
      for (const p of positions) {
        if (p >= limit) {
          errors.push(`Element "${el.id}" occupies position ${p} which is out of bounds (limit=${limit}).`);
          continue;
        }
        const other = occupiedInLayer.get(p);
        if (other !== undefined) {
          warnings.push(`Position ${p} in layer "${layer.id}" is claimed by both "${other}" and "${el.id}". Last-placed-wins applies.`);
        }
        occupiedInLayer.set(p, el.id);
      }
    }
  }
  return { errors, warnings };
}
