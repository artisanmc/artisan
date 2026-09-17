/**
 * Artisan — Menu schema v1 — TypeScript types
 *
 * Source de vérité pour le format intermédiaire d'un menu.
 * Maintenu à la main, en miroir de schema.json. Les deux DOIVENT rester synchrones.
 *
 * Vocabulaire :
 *   - "position"     : position Minecraft dans l'inventaire (0-53). Ce que le jeu appelle "slot".
 *   - "Element"      : objet Artisan (bouton, décoration, liste paginée, grid de data...) qui occupe une ou plusieurs positions.
 *   - "Layer"        : conteneur qui groupe des Elements liés thématiquement.
 *                      Ordonnés bottom→top dans Menu.layers ; render walk top→bottom avec fall-through naturel.
 *   - "Appearance"   : variante visuelle d'un Element. Évaluée dans l'ordre, première dont `if` matche gagne.
 *                      Pas de partial override — chaque Appearance est complète et auto-suffisante.
 *   - "ContextInput" : slot nommée et typée que le menu déclare via Menu.contextInputs. Peuplée à l'ouverture
 *                      par auto-binding par nom (depuis l'appelant) ou via un ConnectorBinding attaché.
 *                      Exposée comme {name} dans les champs du menu. Cf. main-spec §14, §15.4.
 *   - "ConnectorBinding" : référence (côté consommateur) vers une data source (homemade Artisan ou registered par plugin tier en V2)
 *                          qui expose une liste/objet typé. Attaché à un ContextInput via `source`. Les Elements
 *                          itèrent via `iterates: { source: <input_name>, alias }` et accèdent aux champs
 *                          de l'item courant via {alias.field}.
 */

// ============================================================================
// TOP-LEVEL
// ============================================================================

export interface Menu {
  schema: "menu/v1";
  id: string;
  /** Couches de titre, ordonnées. Vide = pas de titre. Format pixel-perfect (offsets, fonts) documenté dans editor-internals.md. */
  title: MenuTitleLayer[];
  size: 9 | 18 | 27 | 36 | 45 | 54;
  permission?: string;
  /** Notes internes de l'admin (jamais rendues aux joueurs). Round-trip-safe JSON ↔ YAML. */
  notes?: string;
  /** Apparence par défaut des positions non couvertes par un Element visible (fall-through ultime). */
  background?: Appearance;
  /** Slots nommées que le menu expose. Peuplées à l'ouverture par auto-binding par nom (cf. main-spec §15.4) ou par un ConnectorBinding (cf. §14). Référencées via {name} dans tout champ texte du menu. */
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

/** Référence i18n. La valeur résolue vit dans lang/<lang>.yaml. */
export interface LText {
  key: string;
}

/** Taille de police autorisée pour les title-layers text/textarea. */
export type TitleFontSize = 8 | 12 | 16 | 20 | 24 | 32;

/**
 * Couche de titre. Format pixel-perfect (pixel offsets, fonts custom) documenté
 * dans editor-internals.md. Le titre d'un menu est un tableau ordonné de ces couches.
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
  /** Slug exposé comme {name} dans les champs du menu. Unique au sein du menu. */
  name: string;
  type: "player" | "string" | "integer" | "number" | "boolean" | "list" | "object";
  /** Valeur fallback si l'appelant ne passe rien et qu'aucune data source n'est attachée. Supporte les placeholders. */
  default?: string;
  /** Si présent, la valeur de la slot est fetchée par une data source au lieu d'être passée par l'appelant. Valide uniquement sur type="list" ou type="object". */
  source?: ConnectorBinding;
}

export interface ConnectorBinding {
  /** "namespace:source", ex: "chestshop:items", "essentials:warps", "jobs:list". */
  ref: string;
  /** Paramètres passés à la data source (varient par data source). Supportent {name} pour interpoler les autres contextInputs du menu. */
  params?: Record<string, string>;
  /** Filtres appliqués sur les champs de la data avant render. Supportent {name} pour interpoler les autres contextInputs. Ex: { category: "{category}" } pour filtrer par la valeur de l'input "category". */
  filter?: Record<string, string>;
  sort?: { by: string; direction?: "asc" | "desc" };
  /** Default = nombre de positions de l'Element qui itère cette slot. Max 1000. */
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
  /** Slug stable, unique dans le menu. */
  id: string;
  /** Nom affiché dans le panel layer de l'éditeur. */
  name: string;
  /** Notes internes de l'admin (jamais rendues aux joueurs). */
  notes?: string;
  /** Elements dans ce layer. Last-placed-wins en cas d'overlap. */
  elements: Element[];
}

// ============================================================================
// ELEMENT
// ============================================================================

/**
 * Un Element : ses clés structurelles, plus — À PLAT — les champs de son
 * **display**, l'apparence rendue quand aucun état ne s'applique. D'où
 * l'extension d'`Appearance` : au premier niveau d'un Element, tout ce qui n'est
 * pas structurel est un champ du display.
 */
export interface Element extends Appearance {
  /** Identifiant stable, unique dans le menu (toutes layers confondues). */
  id: string;
  /** "15" pour position unique, "10-43" pour une range. */
  positions: string;
  /**
   * États gardés, essayés dans l'ordre AVANT le display. Le premier dont le `if`
   * passe gagne ; si aucun ne passe, le display est rendu. Un état est une
   * apparence ENTIÈRE, pas un patch : ce qu'il n'écrit pas est absent, jamais
   * hérité du display (ADR `element-display-and-states`).
   */
  states?: Appearance[];
  /**
   * Si présent, l'Element devient itératif : pour chaque item du contextInput nommé `source`
   * (de type "list"), le moteur évalue ses apparences avec l'item courant exposé sous `alias`,
   * accessible via {alias.field}. La liste source peut venir de l'appelant ou d'une data source —
   * transparent côté Element. Mutuellement exclusif avec component_ref dans une appearance.
   */
  iterates?: { source: string; alias: string };
  template_ref?: TemplateRef | null;
  tags?: string[];
}

export interface Appearance {
  /** Conditions ANDées. Si absent, matche toujours (fallback, à placer en dernier). */
  if?: Condition[];
  asset?: string;
  /** "DIAMOND" littéral, {input_name} pour un contextInput, ou {alias.field} dans un Element qui itère. */
  material?: string;
  /**
   * Référence ou expression d'item complet : quantité et métadonnées sont héritées
   * de l'item désigné, puis écrasées par les champs de présentation explicites.
   * Mutuellement exclusif avec `material`.
   */
  item?: string;
  /** Tête custom : hdb:<id>, basehead:<base64>, ou playerhead:<pseudo>. Ignoré si material ≠ PLAYER_HEAD. */
  head?: string;
  count?: number;
  title?: string;
  lore?: string[];
  /** `replace` : cette lore REMPLACE celle héritée d'`item` au lieu de s'y ajouter. Absent = ajout (comportement historique). */
  lore_mode?: "replace";
  /** Map id → niveau ({ sharpness: 5 }) ; la forme liste est lue mais jamais écrite. */
  enchants?: Record<string, number> | { id: string; level?: number }[];
  /** Effet brillant sans enchantement réel. Redondant quand `enchants` est présent. */
  enchanted?: boolean;
  custom_model_data?: string;
  unbreakable?: boolean;
  /** Sections du tooltip masquées (ItemFlag Bukkit, orthographe courte). */
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
  /** Teinte #rrggbb — cuir / potion / étoile de feu d'artifice. */
  color?: string;
  /** SNBT brut appliqué en dernier (échappatoire, best-effort). */
  nbt?: string;
  component_ref?: string;
  click?: ClickMap | null;
  /** Notes internes de l'admin (jamais rendues aux joueurs). */
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
 * Un handler de clic : une chaîne **Action DSL** (`steps`) — la sérialisation
 * texte de la séquence d'actions + branches if. Cf. ADR `action-dsl` (Phase 2 :
 * les steps structurés `{kind,action|cases}` sont remplacés par la string DSL).
 * Les types {@link Step}/{@link IfCase} ci-dessous décrivent la forme que le DSL
 * parse (domaine), plus le wire.
 */
export interface ClickHandler {
  steps: string;
}

/** Un cas conditionnel dans un Step `if`. */
export interface IfCase {
  conditions: Condition[];
  /** Opérateurs de jonction entre conditions (par défaut tout ANDé). */
  joins?: ("and" | "or")[];
  steps: Step[];
}

/** Une étape d'un handler de clic : soit une action, soit une branche conditionnelle. */
export type Step =
  | { kind: "action"; action: Action }
  | { kind: "if"; cases: IfCase[]; else?: Step[] };

// ============================================================================
// ACTIONS (21)
// ============================================================================

export type Action =
  | RunCommandAction | OpenMenuAction | CloseMenuAction
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
   * Override explicite de l'auto-binding par nom (cf. main-spec §15.4). Chaque entrée
   * peuple un contextInput du menu cible ; les valeurs supportent {name} pour interpoler
   * la scope courante (args de commande, contextInputs de l'appelant, alias d'iteration).
   */
  context?: Record<string, string>;
  /** Désactive l'auto-binding par nom (l'override `context` reste actif). */
  clear_context?: boolean;
}
export interface CloseMenuAction  { type: "close_menu"; }
export interface GiveItemAction   { type: "give_item"; material: string; count: number; nbt?: string; name?: string; lore?: string[]; }
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
 * Compare un placeholder à une valeur. Le placeholder peut être un PAPI (%vault_eco_balance%),
 * un contextInput ({category}), ou un champ d'iteration ({shop.rarity}). Remplace les anciennes
 * conditions data_field_* — utiliser {alias.field} sur un Element qui itère.
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
// TEMPLATES (stockés à part)
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
  "run_command", "open_menu", "close_menu",
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

/** Parse "15" ou "10-43" en intervalle [from, to] inclusif. Renvoie null si invalide. */
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
 * Vérifie ids uniques cross-layer + positions in-bounds + layer ids uniques + cohérence iterates/component_ref
 * + résolution des `iterates.source` contre les contextInputs.
 * Overlap intra-layer = warning (last-placed-wins, pas une erreur).
 * Cross-layer overlap = OK (pattern fall-through intentionnel).
 */
export function validateMenuLayout(menu: Pick<Menu, "size" | "layers" | "context_inputs">): LayoutCheck {
  const errors: string[] = [];
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

      // iterates / component_ref mutex + iterates.source résoluble en contextInput de type "list"
      if (el.iterates) {
        for (const app of [el, ...(el.states ?? [])]) {
          if (app.component_ref) {
            errors.push(`Element "${el.id}" mélange iterates et appearance.component_ref — incompatibles.`);
            break;
          }
        }
        const input = inputsByName.get(el.iterates.source);
        if (!input) {
          errors.push(`Element "${el.id}" iterates.source "${el.iterates.source}" ne référence aucun contextInput.`);
        } else if (input.type !== "list") {
          errors.push(`Element "${el.id}" iterates.source "${el.iterates.source}" doit être un contextInput de type "list" (actuellement "${input.type}").`);
        }
      }

      const r = parsePositions(el.positions);
      if (!r) {
        errors.push(`Element "${el.id}" has invalid positions "${el.positions}".`);
        continue;
      }
      for (let p = r.from; p <= r.to; p++) {
        if (p >= menu.size) {
          errors.push(`Element "${el.id}" occupies position ${p} which is out of bounds (size=${menu.size}).`);
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
