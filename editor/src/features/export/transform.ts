import { addressedAppearances } from "@/domain/element";
import { visitDataSourceLTexts } from "@/domain/i18nSites";
import { writeAdvanced } from "@/domain/itemAdvanced";
import { getTitleTextLayers } from "@/domain/menuTitle";
import { walkActions } from "@/domain/stepPath";
import type {
  Action,
  Appearance,
  AssetId,
  Command,
  Condition,
  DataModel,
  DataModelId,
  DataSource,
  Dialog,
  DialogBody,
  DialogButton,
  DialogInput,
  Element,
  I18nKey,
  Menu,
  MenuTitleLayer,
  ModelField,
  ModelFieldType,
  Project,
  Step,
} from "@/domain/types";
import { slotCount } from "@/features/canvas/inventoryTypes";
import { stepsToDsl } from "@/lib/actionDsl";
import { DURATION_DEFAULTS, DURATION_KEYS } from "@/lib/expr/duration";
import { listLanguages } from "@/lib/i18nUsages";
import { nestLangTree } from "@/lib/langTree";
import { collectModuleExportFiles, getModule } from "@artisan/editor-sdk";
import { Document as YamlDocument, stringify } from "yaml";

const i18nRef = (key: string): string => `{i18n:${key}}`;

/**
 * How LText refs serialize inside steps: menu/command export wraps the key in
 * `{i18n:…}` (translated at runtime); module-data steps (SchemaForm `actions`
 * widget) carry the literal text in `key` and emit it verbatim.
 */
type StepTextOf = (key: string) => string;

/**
 * How a key site's text lands in a document, per the project's i18n mode:
 *
 *  - `extract` (default) — the `{i18n:key}` ref; every language, the default
 *    one included, lives in `lang/<lang>.yaml`.
 *  - `inline` — the DEFAULT language's literal text, written where a reader
 *    expects to read it. The other languages travel in `lang/<lang>.yaml` under
 *    the site's canonical ADDRESS, which the plugin recomputes from the file
 *    structure at load (`I18nAddresses.kt`, `MenuTitleParser`,
 *    `DialogTextResolver`) — the addresses being exactly the canonical keys
 *    `rekeyProject` assigns just before this runs. Locked cross-language by
 *    `testdata/i18n-address-conformance.json`.
 */
function textSerializer(project: Project): StepTextOf {
  if (project.i18nMode !== "inline") return i18nRef;
  return (key) => project.i18nKeys[key as I18nKey]?.[project.defaultLang] ?? "";
}

// ─── condition serialization ────────────────────────────────────────────────
// Most conditions are stored snake_case and contain no LText — pass through
// as-is. Exceptions: composites (recursive) and pagination (camelCase domain).

function serializeCondition(c: Condition): unknown {
  if (c.type === "not") return { type: "not", of: serializeCondition(c.of) };
  if (c.type === "and") return { type: "and", of: (c.of as Condition[]).map(serializeCondition) };
  if (c.type === "or") return { type: "or", of: (c.of as Condition[]).map(serializeCondition) };
  if (c.type === "pagination_at_first" || c.type === "pagination_at_last") {
    return { type: c.type, ...(c.elementId ? { element_id: c.elementId } : {}) };
  }
  return c;
}

/**
 * Canonical appearance `if` is a Condition[] (ANDed). We mirror the prior
 * single-join semantics: one join op governs the whole list. A pure-OR list
 * becomes a single wrapped `or`; otherwise the array is emitted as-is (ANDed).
 */
function serializeIfArray(conditions: Condition[], joins?: ("and" | "or")[]): unknown[] {
  if (conditions.length === 1) return [serializeCondition(conditions[0]!)];
  const items = conditions.map(serializeCondition);
  if ((joins?.[0] ?? "and") === "or") return [{ type: "or", of: items }];
  return items;
}

// ─── action serialization ────────────────────────────────────────────────────

function serializeAction(action: Action, textOf: StepTextOf = i18nRef): unknown {
  switch (action.type) {
    case "open_menu": {
      const out: Record<string, unknown> = { type: "open_menu", menu_id: action.menuId };
      if (action.clearContext) out.clear_context = true;
      if (action.context) out.context = action.context;
      return out;
    }
    case "send_message":
      return { type: "send_message", text: textOf(action.text.key) };
    case "show_title": {
      const out: Record<string, unknown> = { type: "show_title", title: textOf(action.title.key) };
      if (action.subtitle) out.subtitle = textOf(action.subtitle.key);
      if (action.fadeIn !== undefined) out.fade_in = action.fadeIn;
      if (action.stay !== undefined) out.stay = action.stay;
      if (action.fadeOut !== undefined) out.fade_out = action.fadeOut;
      return out;
    }
    case "run_command":
      return { type: "run_command", command: action.command, as: action.as };
    case "close_menu":
      return { type: "close_menu" };
    case "give_item":
      return { type: "give_item", material: action.material, count: action.count };
    case "take_item":
      return { type: "take_item", material: action.material, count: action.count };
    case "take_money":
      return { type: "take_money", amount: action.amount };
    case "give_money":
      return { type: "give_money", amount: action.amount };
    case "give_xp":
      return { type: "give_xp", amount: action.amount };
    case "give_level":
      return { type: "give_level", amount: action.amount };
    case "broadcast":
      return { type: "broadcast", text: textOf(action.text.key) };
    case "play_sound": {
      const out: Record<string, unknown> = { type: "play_sound", sound: action.sound };
      if (action.volume !== undefined) out.volume = action.volume;
      if (action.pitch !== undefined) out.pitch = action.pitch;
      return out;
    }
    case "teleport": {
      const out: Record<string, unknown> = {
        type: "teleport",
        world: action.world,
        x: action.x,
        y: action.y,
        z: action.z,
      };
      if (action.yaw !== undefined) out.yaw = action.yaw;
      if (action.pitch !== undefined) out.pitch = action.pitch;
      return out;
    }
    case "paginate": {
      const type = action.direction === "next" ? "pagination_next" : "pagination_prev";
      const out: Record<string, unknown> = { type };
      if (action.targetElementId) out.element_id = action.targetElementId;
      return out;
    }
    case "set_arg":
      return { type: "set_arg", arg: action.arg, value: action.value };
    case "set_arg_cycle_next":
      return { type: "set_arg_cycle_next", arg: action.arg, list: action.list };
    case "set_arg_cycle_prev":
      return { type: "set_arg_cycle_prev", arg: action.arg, list: action.list };
    case "open_dialog": {
      const out: Record<string, unknown> = { type: "open_dialog", dialog_id: action.dialogId };
      if (action.clearContext) out.clear_context = true;
      if (action.context && Object.keys(action.context).length > 0) out.context = action.context;
      return out;
    }
    case "close_dialog":
      return { type: "close_dialog" };
    default:
      return action;
  }
}

// ─── step tree serialization ─────────────────────────────────────────────────

function serializeStep(step: Step, project: Project, textOf: StepTextOf = i18nRef): unknown {
  if (step.kind === "action") {
    return { kind: "action", action: serializeAction(step.action, textOf) };
  }
  const out: Record<string, unknown> = {
    kind: "if",
    cases: step.cases.map((c) => ({
      conditions: c.conditions.map(serializeCondition),
      ...(c.joins ? { joins: c.joins } : {}),
      steps: c.steps.map((s) => serializeStep(s, project, textOf)),
    })),
  };
  if (step.else) {
    out.else = step.else.map((s) => serializeStep(s, project, textOf));
  }
  return out;
}

/**
 * Serialize steps with LITERAL text (the LText `key` holds the raw string) —
 * the wire shape of module-data steps (`actions` field kit widget). Same
 * structure the plugin's ActionParser reads, minus the `{i18n:…}` indirection.
 */
export function serializeStepsLiteral(steps: Step[]): unknown[] {
  return steps.map((s) => serializeStep(s, undefined as unknown as Project, (key) => key));
}

// ─── appearance serialization ────────────────────────────────────────────────

function serializeAppearance(app: Appearance, project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (app.if && app.if.length > 0) out.if = serializeIfArray(app.if, app.ifJoins);
  if (app.image) out.image = app.image;
  else if (app.item !== undefined) out.item = app.item;
  else if (app.material) out.material = app.material;
  if (app.head) out.head = app.head;
  if (app.count !== undefined) out.count = app.count;
  const t = textSerializer(project);
  if (app.title) out.title = t(app.title.key);
  if (app.lore) out.lore = [t(app.lore.key)];
  if (app.loreMode) {
    out.lore_mode = app.loreMode;
    if (!app.lore) out.lore = [];
  }
  if (app.click) {
    const clickOut: Record<string, unknown> = {};
    for (const [clickType, handler] of Object.entries(app.click)) {
      if (!handler) continue;
      // Canonical collapsed form: the handler IS the Action DSL string (ADR
      // action-dsl); menu action text is a Key site → `@key`, else a "literal".
      clickOut[clickType] = stepsToDsl(handler.steps, project);
    }
    if (Object.keys(clickOut).length > 0) out.click = clickOut;
  }
  writeAdvanced(app, out);
  return out;
}

// ─── element serialization ───────────────────────────────────────────────────

/**
 * Serialize an element. A set is self-contained: how its rows look and behave
 * lives on the element that renders them, in the menu it belongs to — there is
 * no project-level template to resolve.
 */
function serializeElement(el: Element, project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: el.id,
    // A single numeric position emits as a bare int (no YAML quoting trap);
    // ranges/comma lists stay strings.
    positions: /^\d+$/.test(el.positions) ? Number(el.positions) : el.positions,
    // The display is written FLAT on the element (ADR
    // `element-display-and-states`); `serializeAppearance` only ever emits
    // appearance keys, which `elementStructuralKeys` keeps disjoint from ours.
    ...serializeAppearance(el.display, project),
  };
  if (el.iterates) {
    out.iterates = { source: el.iterates.source, alias: el.iterates.alias };
  }
  if (el.places) {
    // `key_field` is snake_case on the wire (plugin PlacesYaml); cachedDisplay is
    // editor-only (offline render fallback) and never exported to the bundle.
    out.places = {
      source: el.places.source,
      alias: el.places.alias,
      key_field: el.places.keyField,
      placements: el.places.placements.map((p) => ({
        key: p.key,
        page: p.page,
        position: p.position,
      })),
    };
  }
  if (el.states.length > 0) {
    out.states = el.states.map((s) => serializeAppearance(s, project));
  }
  if (el.tags && el.tags.length > 0) out.tags = el.tags;
  return out;
}

// ─── layer serialization ─────────────────────────────────────────────────────

/** Canonical wire is a flat `elements` list (document order = stacking order,
 *  later wins per slot) — editor layers flatten at export; the legacy `layers`
 *  wrapping is import-only. */
function serializeElements(menu: Menu, project: Project): Record<string, unknown>[] {
  return menu.layers.flatMap((l) => l.elements).map((el) => serializeElement(el, project));
}

// ─── title layer serialization ───────────────────────────────────────────────

function serializeTitleLayer(
  layer: MenuTitleLayer,
  t: StepTextOf,
): Record<string, unknown> | string {
  if (layer.kind === "background") {
    return { kind: "background", asset_id: layer.assetId };
  }
  if (layer.kind === "glyph") {
    return { kind: "glyph", asset_id: layer.assetId, x: layer.x, y: layer.y };
  }
  if (layer.kind === "text") {
    const out: Record<string, unknown> = {
      kind: "text",
      // LText values serialize to the single string form (`{i18n:key}`),
      // matching appearances/actions — the `{key}` object form is import-only.
      value: t(layer.value.key),
      x: layer.x,
      y: layer.y,
    };
    if (layer.color !== undefined) out.color = layer.color;
    if (layer.fontAssetId !== undefined) out.font_asset_id = layer.fontAssetId;
    if (layer.size !== undefined && layer.size !== 8) out.size = layer.size;
    return out;
  }
  if (layer.kind === "plain") {
    // Canonical sugar: an uncolored plain layer is just its string.
    if (layer.color === undefined) return t(layer.value.key);
    return { kind: "plain", value: t(layer.value.key), color: layer.color };
  }
  if (layer.kind === "textarea") {
    const out: Record<string, unknown> = {
      kind: "textarea",
      value: t(layer.value.key),
      x: layer.x,
      y: layer.y,
      width: layer.width,
      line_height: layer.lineHeight,
      alignment: layer.alignment,
    };
    if (layer.fontAssetId !== undefined) out.font_asset_id = layer.fontAssetId;
    if (layer.size !== undefined && layer.size !== 8) out.size = layer.size;
    return out;
  }
  if (layer.kind === "external_glyph") {
    return {
      kind: "external_glyph",
      provider: layer.provider,
      glyph_name: layer.glyphName,
      x: layer.x,
      y: layer.y,
    };
  }
  // Exhaustive guard — TS narrows `layer` to `never` here; runtime fallback
  // returns the layer untouched if a future kind isn't yet handled.
  return layer;
}

// ─── legacy title reader ─────────────────────────────────────────────────────

const LEGACY_TEXT_X = 8;
const LEGACY_TEXT_Y = 5;

/**
 * Accepts the YAML node found at `menu.title` and normalises it to a
 * `MenuTitleLayer[]`. Supports:
 *
 * - `null`/`undefined`              → `[]`
 * - `string`                        → one text layer at (8,5) using the
 *                                     string as a literal i18n key (the
 *                                     legacy format before Task 11)
 * - single `{ kind, ... }` map      → wrapped in a one-element array
 * - `[{ kind, ... }, ...]`          → mapped element-by-element
 *
 * Unknown kinds are filtered out (caller-side import code can warn).
 * Exported so a future YAML→domain import path can call it; the serializer
 * itself doesn't invoke it.
 */
export function parseTitleNode(node: unknown): MenuTitleLayer[] {
  if (node === null || node === undefined) return [];
  if (typeof node === "string") {
    // Canonical sugar (and legacy string format) → one plain vanilla layer.
    const key = titleValueKey(node);
    return key === null ? [] : [{ kind: "plain", value: { key } }];
  }
  if (Array.isArray(node)) {
    const out: MenuTitleLayer[] = [];
    for (const entry of node) {
      const layer = parseTitleLayer(entry);
      if (layer) out.push(layer);
    }
    return out;
  }
  if (typeof node === "object") {
    const layer = parseTitleLayer(node);
    return layer ? [layer] : [];
  }
  return [];
}

function titleValueKey(value: unknown): I18nKey | null {
  // Canonical string form: "{i18n:key}" (or a raw key for legacy string titles).
  if (typeof value === "string") {
    const m = /^\{i18n:(.+)\}$/.exec(value);
    return (m ? m[1]! : value) as I18nKey;
  }
  // Legacy {key} object form.
  if (value && typeof value === "object" && typeof (value as { key?: unknown }).key === "string") {
    return (value as { key: string }).key as I18nKey;
  }
  return null;
}

function parseTitleLayer(node: unknown): MenuTitleLayer | null {
  // A bare string entry is a plain text layer (canonical sugar).
  if (typeof node === "string") {
    const key = titleValueKey(node);
    return key === null ? null : { kind: "plain", value: { key } };
  }
  if (!node || typeof node !== "object") return null;
  const m = node as Record<string, unknown>;
  // Ref d'asset : `asset: <nom>` d'abord, `asset_id: <id opaque>` ensuite. Le
  // nom de fichier devient l'identité d'un asset (ADR `assets-on-server-disk`)
  // — l'ancienne forme reste lue tant que la descente n'a pas eu lieu.
  const assetRef = (key: "asset" | "font"): string | null => {
    const legacy = key === "asset" ? "asset_id" : "font_asset_id";
    if (typeof m[key] === "string") return m[key] as string;
    if (typeof m[legacy] === "string") return m[legacy] as string;
    return null;
  };
  switch (m.kind) {
    case "background": {
      const ref = assetRef("asset");
      if (ref === null) return null;
      return { kind: "background", assetId: ref as AssetId };
    }
    case "glyph": {
      const ref = assetRef("asset");
      if (ref === null) return null;
      return {
        kind: "glyph",
        assetId: ref as AssetId,
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
      };
    }
    case "text": {
      const key = titleValueKey(m.value);
      if (!key) return null;
      const out: MenuTitleLayer = {
        kind: "text",
        value: { key },
        x: typeof m.x === "number" ? m.x : LEGACY_TEXT_X,
        y: typeof m.y === "number" ? m.y : LEGACY_TEXT_Y,
      };
      if (typeof m.color === "string") out.color = m.color;
      const fontRef = assetRef("font");
      if (fontRef !== null) out.fontAssetId = fontRef as AssetId;
      if (typeof m.size === "number" && [8, 12, 16, 20, 24, 32].includes(m.size)) {
        out.size = m.size as 8 | 12 | 16 | 20 | 24 | 32;
      }
      return out;
    }
    case "plain": {
      const key = titleValueKey(m.value);
      if (!key) return null;
      const out: MenuTitleLayer = { kind: "plain", value: { key } };
      if (typeof m.color === "string") out.color = m.color;
      return out;
    }
    case "textarea": {
      const key = titleValueKey(m.value);
      if (!key) return null;
      const rawAlign = typeof m.alignment === "string" ? m.alignment : "left";
      const alignment: "left" | "center" | "right" =
        rawAlign === "center" ? "center" : rawAlign === "right" ? "right" : "left";
      const rawLh = typeof m.line_height === "number" ? m.line_height : 10;
      const lineHeight = Math.min(32, Math.max(1, rawLh));
      const rawW = typeof m.width === "number" ? m.width : 168;
      const width = Math.min(256, Math.max(8, rawW));
      const out: MenuTitleLayer = {
        kind: "textarea",
        value: { key },
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
        width,
        lineHeight,
        alignment,
      };
      const fontRef = assetRef("font");
      if (fontRef !== null) out.fontAssetId = fontRef as AssetId;
      if (typeof m.size === "number" && [8, 12, 16, 20, 24, 32].includes(m.size)) {
        out.size = m.size as 8 | 12 | 16 | 20 | 24 | 32;
      }
      return out;
    }
    case "external_glyph": {
      const provider = m.provider;
      if (provider !== "oraxen" && provider !== "nexo" && provider !== "itemsadder") return null;
      if (typeof m.glyph_name !== "string") return null;
      return {
        kind: "external_glyph",
        provider,
        glyphName: m.glyph_name,
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
      };
    }
    default:
      return null;
  }
}

// ─── menu serialization ──────────────────────────────────────────────────────

/**
 * Serialize a single Menu into a canonical `menu/v1` object (snake_case,
 * `{i18n:key}` refs, title-as-layer-array). This is the public seed used by
 * the AI assistant (`projectToMenuV1`) *and* the internal file exporter
 * (`transform()`), so the wire shape stays single-sourced.
 */
export function serializeMenuToV1(
  menu: Menu,
  project: Project,
): { id: string } & Record<string, unknown> {
  const type = menu.inventoryType ?? "chest";
  const t = textSerializer(project);
  const out: Record<string, unknown> = {
    schema: "menu/v1",
    id: menu.id,
    // Canonical sugar: a title that is exactly one uncolored plain layer
    // serializes to a bare string.
    title:
      menu.title.length === 1 &&
      menu.title[0]!.kind === "plain" &&
      menu.title[0]!.color === undefined
        ? serializeTitleLayer(menu.title[0]!, t)
        : menu.title.map((l) => serializeTitleLayer(l, t)),
    size: slotCount(type, menu.rows),
    elements: serializeElements(menu, project),
  };
  if (type !== "chest") out.inventory_type = type;
  if (menu.playerInventory === "hidden") out.player_inventory = "hidden";
  if (menu.permission) out.permission = menu.permission;
  if (menu.notes) out.notes = menu.notes;
  if (menu.contextInputs && menu.contextInputs.length > 0) {
    // Canonical field name: `inputs` (`context_inputs` is the legacy spelling).
    out.inputs = menu.contextInputs.map((ci) => {
      if (ci.kind === "primitive") {
        const c: Record<string, unknown> = { name: ci.name, type: ci.type };
        if (ci.rowOf !== undefined) c.row_of = ci.rowOf;
        if (ci.default !== undefined) c.default = ci.default;
        return c;
      }
      // Canonical connector shape — `source` is a ConnectorBinding; `type`
      // is required by the schema (connector-fed inputs are lists in v1).
      const source: Record<string, unknown> = { ref: ci.ref };
      if (ci.params) source.params = ci.params;
      if (ci.filter) source.filter = ci.filter;
      if (ci.sort) source.sort = ci.sort;
      if (ci.limit !== undefined) source.limit = ci.limit;
      return { name: ci.name, type: "list", source };
    });
  }
  return out as { id: string } & Record<string, unknown>;
}

/** Serialize every menu in a project to canonical `menu/v1` objects (one per menu). */
export function projectToMenuV1(project: Project): ({ id: string } & Record<string, unknown>)[] {
  return project.menus.map((m) => serializeMenuToV1(m, project));
}

// ─── command serialization ───────────────────────────────────────────────────

export function serializeCommand(cmd: Command, project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema: "command/v1",
    id: cmd.id,
    // `name` (the in-game trigger) is only written when it differs from `id`.
    ...(cmd.name !== cmd.id ? { name: cmd.name } : {}),
    // The command's action chain serializes to an Action DSL string (ADR
    // action-dsl). Canonical field: `actions` (`steps` is the legacy spelling).
    actions: stepsToDsl(cmd.steps, project),
  };
  if (cmd.aliases && cmd.aliases.length > 0) out.aliases = cmd.aliases;
  if (cmd.permission) out.permission = cmd.permission;
  if (cmd.description) out.description = cmd.description;
  if (cmd.arguments && cmd.arguments.length > 0) {
    out.arguments = cmd.arguments.map((arg) => ({
      name: arg.name,
      type: arg.type,
      required: arg.required,
      ...(arg.default !== undefined ? { default: arg.default } : {}),
    }));
  }
  return out;
}

/** Serialize every command in a project to canonical command/v1 objects. */
export function projectToCommandV1(project: Project): Record<string, unknown>[] {
  return project.commands.map((c) => serializeCommand(c, project));
}

// ─── dialog serialization ────────────────────────────────────────────────────

function serializeDialogBody(body: DialogBody, t: StepTextOf): Record<string, unknown> {
  if (body.type === "text") return { type: "text", text: t(body.text.key) };
  return { type: "item", material: body.material, count: body.count };
}

function serializeDialogInput(input: DialogInput, t: StepTextOf): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    label: t(input.label.key),
  };
  if (input.type === "text") {
    out.default = input.default;
    out.max_length = input.maxLength;
  } else if (input.type === "bool") {
    out.default = String(input.default);
  } else if (input.type === "number_range") {
    out.min = input.min;
    out.max = input.max;
    out.default = String(input.default);
  } else if (input.type === "single_option") {
    out.options = input.options.map((opt) => ({ value: opt.value, label: t(opt.label.key) }));
    out.default = input.default;
  }
  return out;
}

function serializeDialogButton(
  btn: DialogButton,
  project: Project,
  t: StepTextOf,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: btn.id, label: t(btn.label.key) };
  // dialog/v1 button actions serialize to an Action DSL string (ADR action-dsl
  // Phase 2). Unlike the old flat-action wire, if-branches now round-trip.
  const dsl = stepsToDsl(btn.steps, project);
  if (dsl !== "") out.actions = dsl;
  return out;
}

export function serializeDialog(dialog: Dialog, project: Project): Record<string, unknown> {
  const t = textSerializer(project);
  const out: Record<string, unknown> = {
    schema: "dialog/v1",
    id: dialog.id,
    title: t(dialog.title.key),
  };
  if (!dialog.canCloseWithEscape) out.can_close_with_escape = false;
  if (dialog.body.length > 0) out.body = dialog.body.map((b) => serializeDialogBody(b, t));
  if (dialog.inputs.length > 0) out.inputs = dialog.inputs.map((i) => serializeDialogInput(i, t));
  out.buttons = dialog.buttons.map((b) => serializeDialogButton(b, project, t));
  return out;
}

/** Serialize every dialog in a project to canonical dialog/v1 objects. */
export function projectToDialogV1(project: Project): Record<string, unknown>[] {
  return project.dialogs.map((d) => serializeDialog(d, project));
}

// ─── translations serialization ──────────────────────────────────────────────

function addActionKeys(action: Action, keys: Set<string>): void {
  if (action.type === "send_message" || action.type === "broadcast") keys.add(action.text.key);
  else if (action.type === "show_title") {
    keys.add(action.title.key);
    if (action.subtitle) keys.add(action.subtitle.key);
  }
}

/**
 * Keys that belong to the **project**, not to any document site: presentation
 * settings an admin may want to override (the `until()` duration units).
 *
 * They are why inline mode still emits a default-language lang file. The "no
 * default lang file in inline mode" rule exists because a site-addressed key
 * would be a second copy of text that already lives in its document — a siteless
 * key has no document to live in, so the lang file is its only home.
 */
const SITELESS_KEYS: string[] = Object.values(DURATION_KEYS);

/** The default each presentation key is written out with, keyed by the key itself. */
const DURATION_DEFAULTS_BY_KEY: Record<string, string> = Object.fromEntries(
  (Object.keys(DURATION_KEYS) as Array<keyof typeof DURATION_KEYS>).map((name) => [
    DURATION_KEYS[name],
    DURATION_DEFAULTS[name],
  ]),
);

function collectReferencedKeys(project: Project): Set<string> {
  const keys = new Set<string>(SITELESS_KEYS);
  for (const menu of project.menus) {
    for (const lt of getTitleTextLayers(menu)) keys.add(lt.key);
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        for (const app of addressedAppearances(el)) {
          if (app.title) keys.add(app.title.key);
          if (app.lore) keys.add(app.lore.key);
          if (app.click) {
            for (const handler of Object.values(app.click)) {
              if (!handler) continue;
              for (const action of walkActions(handler.steps)) addActionKeys(action, keys);
            }
          }
        }
      }
    }
  }
  for (const cmd of project.commands) {
    for (const action of walkActions(cmd.steps)) addActionKeys(action, keys);
  }
  for (const dialog of project.dialogs) {
    if (dialog.title) keys.add(dialog.title.key);
    for (const body of dialog.body) {
      if (body.type === "text") keys.add(body.text.key);
    }
    for (const input of dialog.inputs) {
      keys.add(input.label.key);
      if (input.type === "single_option") {
        for (const opt of input.options) keys.add(opt.label.key);
      }
    }
    for (const btn of dialog.buttons) {
      keys.add(btn.label.key);
      for (const action of walkActions(btn.steps)) addActionKeys(action, keys);
    }
  }
  // NOTE: data-source ltext values are NOT collected here anymore (ADR
  // bare-data-files ④): their default text is inlined in the data file and
  // their other languages are emitted by ADDRESS via dataSourceI18n().
  return keys;
}

function serializeLang(
  project: Project,
  lang: string,
  referencedKeys: Set<string>,
  // Data-source entries, already re-addressed to canonical key sites (ADR
  // bare-data-files ④) — empty for the default language (inlined in data/).
  dataEntries: Record<string, string> = {},
): Record<string, string> {
  const entries: Array<[string, string]> = [];
  // Iterate `referencedKeys` (not `project.i18nKeys`) so we always emit *every*
  // key the runtime will look up — even ones that have never been assigned a
  // value. Otherwise a freshly-created menu with no title typed yet yields a
  // missing key in the YAML, and the plugin falls back to printing the raw
  // key (`menus.foo.title`) to chat instead of nothing.
  for (const key of referencedKeys) {
    const entry = project.i18nKeys[key as keyof typeof project.i18nKeys];
    const val = entry?.[lang];
    if (val !== undefined) {
      entries.push([key, val]);
    } else if (key in DURATION_DEFAULTS_BY_KEY) {
      // A presentation key seeds its actual default, not "": the point of writing
      // it out is that an admin opening lang/ sees what it does and can change it.
      entries.push([key, DURATION_DEFAULTS_BY_KEY[key]!]);
    } else if (lang === project.defaultLang) {
      // Always seed the defaultLang file with an empty string so the runtime
      // resolves the key to "" rather than echoing the raw key.
      entries.push([key, ""]);
    }
  }
  for (const [k, v] of Object.entries(dataEntries)) {
    if (!referencedKeys.has(k)) entries.push([k, v]);
  }
  // Byte-order sort: lang files must be deterministic regardless of key
  // collection order (files-first fixed point — import then re-export may
  // visit documents in a different order).
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out: Record<string, string> = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}

// ─── Project sources (data/v1) ───────────────────────────────────────────────
// Denormalized per ADR project-sources-and-data-models: Data models are inlined
// as flattened field kinds — the Bundle/plugin never see model identity (same
// philosophy as Item templates inlined into menu/v1). ltext values export as
// their canonical i18n keys (translations travel in lang/); item values as refs
// (stacks travel in items/); minimessage fields export as plain strings.

function serializeDataFieldType(
  type: ModelFieldType,
  models: DataModel[],
  visited: Set<DataModelId>,
): Record<string, unknown> {
  switch (type.kind) {
    case "list":
      return { kind: "list", of: serializeDataFieldType(type.of, models, visited) };
    // minimessage is an editor-only editing affordance — the stored value is
    // a plain string, so data/v1 (and the plugin) only ever sees `string`.
    case "minimessage":
    case "minimessage_multiline":
      return { kind: "string" };
    // actions keep their own kind: the value is an Action DSL string the plugin
    // will parse+execute (Action chain). Cf. ADR `action-dsl`.
    case "actions":
      return { kind: "actions" };
    case "object":
      return {
        kind: "object",
        fields: type.fields.map((f) => serializeDataField(f, models, visited)),
      };
    case "model": {
      const model = visited.has(type.ref) ? undefined : models.find((m) => m.id === type.ref);
      if (!model) return { kind: "object", fields: [] };
      const next = new Set(visited).add(type.ref);
      return {
        kind: "object",
        fields: model.fields.map((f) => serializeDataField(f, models, next)),
      };
    }
    // Composable kinds (ADR composable-data-models) — denormalized INLINE so
    // the data file stays self-contained for the model-blind runtime.
    case "map":
      return { kind: "map", of: serializeDataFieldType(type.of, models, visited) };
    case "enum":
      return { kind: "enum", values: type.values };
    case "union":
      return {
        kind: "union",
        tag: type.tag,
        variants: type.variants.map((v) => ({
          name: v.name,
          fields: v.fields.map((f) => serializeDataField(f, models, visited)),
        })),
      };
    default:
      return { kind: type.kind };
  }
}

function serializeDataField(
  field: ModelField,
  models: DataModel[],
  visited: Set<DataModelId>,
): Record<string, unknown> {
  return { name: field.name, ...serializeDataFieldType(field.type, models, visited) };
}

/** ltext inlining context (ADR bare-data-files ④): a value serializes as the
 *  DEFAULT language's literal text; other languages travel in lang/ under the
 *  canonical key-site address. */
interface DataI18nCtx {
  defaultLang: string;
  keys: Record<string, Record<string, string> | undefined>;
}

function serializeDataValue(
  value: unknown,
  type: ModelFieldType,
  models: DataModel[],
  visited: Set<DataModelId>,
  i18n: DataI18nCtx,
): unknown {
  switch (type.kind) {
    case "item": {
      const map = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(map);
        if (v && typeof v === "object") {
          if ("key" in v) return i18n.keys[String(v.key)]?.[i18n.defaultLang] ?? "";
          return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]));
        }
        return v;
      };
      return map(value);
    }
    case "ltext": {
      if (typeof value !== "object" || value === null || !("key" in value)) return "";
      const key = String((value as { key: unknown }).key);
      return i18n.keys[key]?.[i18n.defaultLang] ?? "";
    }
    case "list":
      return Array.isArray(value)
        ? value.map((el) => serializeDataValue(el, type.of, models, visited, i18n))
        : [];
    case "object": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const out: Record<string, unknown> = {};
      for (const f of type.fields)
        out[f.name] = serializeDataValue(obj[f.name], f.type, models, visited, i18n);
      return out;
    }
    case "model": {
      const model = visited.has(type.ref) ? undefined : models.find((m) => m.id === type.ref);
      if (!model) return {};
      const next = new Set(visited).add(type.ref);
      return serializeDataValue(
        value,
        { kind: "object", fields: model.fields },
        models,
        next,
        i18n,
      );
    }
    case "map": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj))
        out[k] = serializeDataValue(v, type.of, models, visited, i18n);
      return out;
    }
    // enum values are plain strings — closedness is enforced at edit time only
    // (non-hermetic contract).
    case "enum":
      return value;
    // Core condition vocabulary (§6): serialize through the single condition
    // codec so composites and camelCase domain fields hit the wire shape.
    case "conditions":
      return Array.isArray(value) ? (value as Condition[]).map(serializeCondition) : [];
    case "union": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const tagValue = obj[type.tag];
      const variant = type.variants.find((v) => v.name === tagValue);
      if (!variant) return { [type.tag]: tagValue };
      const out: Record<string, unknown> = { [type.tag]: tagValue };
      for (const f of variant.fields)
        out[f.name] = serializeDataValue(obj[f.name], f.type, models, visited, i18n);
      return out;
    }
    default:
      return value;
  }
}

// ─── bare data emission (ADR bare-data-files) ────────────────────────────────

/** Non-default translations of every data-source ltext site, re-addressed to
 *  the canonical key-site path, plus the set of node keys those sites hold
 *  (excluded from lang/ — the default text is inlined in the data file). */
function dataSourceI18n(project: Project): {
  nodeKeys: Set<string>;
  byLang: Record<string, Record<string, string>>;
} {
  const nodeKeys = new Set<string>();
  const byLang: Record<string, Record<string, string>> = {};
  for (const ds of project.dataSources ?? []) {
    for (const site of visitDataSourceLTexts(project, ds)) {
      const k = site.lText.key as string;
      nodeKeys.add(k);
      const entry = project.i18nKeys[k as I18nKey];
      if (!entry) continue;
      for (const [lang, val] of Object.entries(entry)) {
        if (lang === project.defaultLang) continue;
        (byLang[lang] ??= {})[site.path] = val;
      }
    }
  }
  return { nodeKeys, byLang };
}

/** Generated header block from the model's presentation hints (⑦): recomputed
 *  at every export, stripped back out at import (marker line `# ──`). */
function generatedHeader(name: string, fields: ModelField[]): string {
  if (!hasAnyHelp(fields)) return "";
  // The hints themselves now sit above the key they document (ADR
  // yaml-assisted-editing ⑥) — the header only says what the file does to
  // comments, because it overwrites them and must not pretend otherwise.
  return (
    [
      `# ── ${name} — géré par Artisan (les valeurs sont éditables à la main)`,
      "# Les commentaires sont générés depuis le schéma : un commentaire ajouté",
      "# ailleurs qu'en tête de fichier est écrasé au prochain enregistrement.",
    ].join("\n") + "\n"
  );
}

function hasAnyHelp(fields: ModelField[]): boolean {
  return fields.some(
    (f) => (typeof f.help === "string" && f.help !== "") || hasAnyHelp(childFields(f.type)),
  );
}

function childFields(type: ModelFieldType): ModelField[] {
  switch (type.kind) {
    case "object":
      return type.fields;
    case "list":
    case "map":
      return childFields(type.of);
    case "union":
      return type.variants.flatMap((v) => v.fields);
    default:
      return [];
  }
}

/**
 * Serialize with each field's `help` as a comment directly above its key, at
 * any depth (ADR yaml-assisted-editing ⑥). Comments carry no data: they are
 * regenerated at every write and ignored at import.
 */
function stringifyWithHints(
  value: unknown,
  fields: ModelField[],
  yamlOpts: { lineWidth: number },
): string {
  const doc = new YamlDocument(value);
  annotate(doc.contents, fields);
  return doc.toString(yamlOpts);
}

function annotate(node: unknown, fields: ModelField[]): void {
  if (!isMap(node)) return;
  for (const field of fields) {
    const pair = node.items.find((p: { key?: unknown }) => scalarKey(p.key) === field.name);
    if (!pair) continue;
    if (typeof field.help === "string" && field.help !== "") {
      // `commentBefore` renders as `# <text>` above the key, indented with it.
      pair.key.commentBefore = ` ${field.help}`;
    }
    annotate(pair.value, childFields(field.type));
  }
}

function isMap(
  node: unknown,
): node is { items: { key: { commentBefore?: string }; value: unknown }[] } {
  return !!node && typeof node === "object" && Array.isArray((node as { items?: unknown }).items);
}

function scalarKey(key: unknown): string | null {
  if (key && typeof key === "object" && "value" in key)
    return String((key as { value: unknown }).value);
  return typeof key === "string" ? key : null;
}

function dataFileHeader(ds: DataSource, name: string, fields: ModelField[]): string {
  const hand = ds.headerComment ? `${ds.headerComment}\n` : "";
  return hand + generatedHeader(name, fields);
}

/** Model ids referenced by a `model`-kind field anywhere (shared — never
 *  emitted at a source's filename). */
function modelKindRefs(models: DataModel[]): Set<string> {
  const out = new Set<string>();
  const walk = (ty: ModelFieldType): void => {
    switch (ty.kind) {
      case "model":
        out.add(String(ty.ref));
        return;
      case "list":
      case "map":
        walk(ty.of);
        return;
      case "object":
        ty.fields.forEach((f) => walk(f.type));
        return;
      case "union":
        ty.variants.forEach((v) => v.fields.forEach((f) => walk(f.type)));
        return;
      default:
        return;
    }
  };
  for (const m of models) m.fields.forEach((f) => walk(f.type));
  return out;
}

/** Row-file name for a per-row Table: the Row key value, slugified; empty or
 *  duplicate keys fall back to `row_<n>` (positional), like i18n row keys. */
export function rowFileName(rows: Record<string, unknown>[], keyField: string, i: number): string {
  const raw = rows[i]?.[keyField];
  const slug =
    typeof raw === "string" || typeof raw === "number"
      ? String(raw)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "_")
      : "";
  if (slug === "" || slug.startsWith("_")) return `row_${i + 1}`;
  const dup = rows.some(
    (r, j) =>
      j !== i &&
      String(r[keyField] ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_") === slug,
  );
  return dup ? `row_${i + 1}` : slug;
}

/**
 * Emit every Project source in the BARE form (ADR bare-data-files): data files
 * are pure values (ltext = default-language literal), the schema lives beside
 * them — models/<sourceId>.yaml (owned model doc, or a one-line `model:` ref)
 * or a minimal per-row `_source.yaml` (`name?`/`model`/`model_version?`/
 * `order`). Returns the model ids whose doc was emitted at a source filename
 * (or intentionally not at all) so the generic models/ loop skips them.
 */
function emitDataSources(
  project: Project,
  base: string,
  files: Record<string, string>,
  yamlOpts: { lineWidth: number },
): Set<string> {
  const models = project.dataModels ?? [];
  const i18n: DataI18nCtx = {
    defaultLang: project.defaultLang,
    keys: project.i18nKeys as unknown as DataI18nCtx["keys"],
  };
  const kindRefs = modelKindRefs(models);
  const tableUse = new Map<string, number>();
  for (const ds of project.dataSources ?? []) {
    if (ds.shape === "table")
      tableUse.set(String(ds.modelId), (tableUse.get(String(ds.modelId)) ?? 0) + 1);
  }
  const claimed = new Set<string>();

  for (const ds of project.dataSources ?? []) {
    if (ds.shape === "config") {
      // Schemaless source (bare file, no model beside it): field-driven
      // serialization would drop every key and empty the file. Untyped values
      // travel verbatim (ADR bare-data-files ③).
      const value =
        ds.fields.length === 0
          ? ds.value
          : serializeDataValue(
              ds.value,
              { kind: "object", fields: ds.fields },
              models,
              new Set(),
              i18n,
            );
      files[`${base}/data/${ds.id}.yaml`] =
        dataFileHeader(ds, ds.name, ds.fields) + stringifyWithHints(value, ds.fields, yamlOpts);
      // A module-declared schema lives in the module's JAR and arrives via
      // Presence — the beside file is a one-line ref, never a copy (ADR
      // yaml-assisted-editing). Only a project-authored schema is written out.
      const declaredModel =
        ds.modelId && models.find((m) => m.id === ds.modelId)?.provenance === "module";
      if (declaredModel) {
        files[`${base}/models/${ds.id}.yaml`] = stringify({ model: String(ds.modelId) }, yamlOpts);
        claimed.add(String(ds.id));
      } else if (ds.fields.length > 0) {
        files[`${base}/models/${ds.id}.yaml`] = stringify(
          { schema: "model/v1", id: ds.id, name: ds.name, fields: ds.fields },
          yamlOpts,
        );
        claimed.add(String(ds.id));
      }
      continue;
    }

    const model = models.find((m) => m.id === ds.modelId);
    const fields = model?.fields ?? [];
    // No resolvable schema (a module-declared model the Presence hasn't
    // delivered, a removed module…): the rows are the user's data — emit them
    // verbatim rather than serializing them against an empty field list, which
    // would blank every row.
    const rowsOut =
      fields.length === 0
        ? ds.rows
        : ds.rows.map((r) =>
            serializeDataValue(
              r,
              { kind: "object", fields },
              models,
              new Set(model ? [model.id] : []),
              i18n,
            ),
          );
    const header = dataFileHeader(ds, ds.name, fields);
    const declared = !model || model.provenance === "module";
    const owned =
      !!model &&
      !declared &&
      (tableUse.get(String(model.id)) ?? 0) === 1 &&
      !kindRefs.has(String(model.id));
    const link: Record<string, unknown> = {
      ...(ds.name !== String(ds.id) ? { name: ds.name } : {}),
      model: String(ds.modelId),
      ...(model?.version !== undefined ? { model_version: model.version } : {}),
    };

    if (ds.granularity === "row") {
      const names = ds.rows.map((_, i) => rowFileName(ds.rows, model?.keyField ?? "id", i));
      files[`${base}/data/${ds.id}/_source.yaml`] =
        header + stringify({ ...link, order: names }, yamlOpts);
      rowsOut.forEach((row, i) => {
        // Each row file is a standalone file someone may open over SSH — it
        // carries the schema's hints like any other (ADR yaml-assisted-editing ⑥).
        files[`${base}/data/${ds.id}/${names[i]}.yaml`] = stringifyWithHints(row, fields, yamlOpts);
      });
      if (owned && fields.length > 0) {
        files[`${base}/models/${ds.id}.yaml`] = stringify(
          {
            schema: "model/v1",
            id: model!.id,
            name: model!.name,
            key_field: model!.keyField,
            ...(model!.masterDetail ? { master_detail: true } : {}),
            fields: model!.fields,
          },
          yamlOpts,
        );
        claimed.add(String(model!.id));
      } else if (owned) {
        claimed.add(String(model!.id)); // untyped synthesized — no doc at all
      }
      continue;
    }

    files[`${base}/data/${ds.id}.yaml`] = header + stringify(rowsOut, yamlOpts);
    if (owned && fields.length > 0) {
      files[`${base}/models/${ds.id}.yaml`] = stringify(
        {
          schema: "model/v1",
          id: model!.id,
          name: model!.name,
          key_field: model!.keyField,
          ...(model!.masterDetail ? { master_detail: true } : {}),
          fields: model!.fields,
        },
        yamlOpts,
      );
      claimed.add(String(model!.id));
    } else if (owned) {
      claimed.add(String(model!.id)); // untyped synthesized — no doc at all
    } else {
      // Declared or shared model: one-line(ish) ref beside the data.
      files[`${base}/models/${ds.id}.yaml`] = stringify(link, yamlOpts);
    }
  }
  return claimed;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Transform a Project into a flat map of filename → YAML string.
 * Keys use the server-side path (e.g. "plugins/Artisan/menus/shop_main.yaml").
 */
/**
 * Retire le champ `id` avant d'écrire un Document sur disque : le fichier porte
 * déjà son identité dans son nom (miroir du `withFileId` du plugin). Les
 * sérialiseurs le gardent parce que l'assistant IA en a besoin sur le fil, où il
 * n'y a pas de nom de fichier pour le porter.
 */
function withoutId<T extends object>(doc: T): Omit<T, "id"> {
  const { id: _id, ...rest } = doc as T & { id?: unknown };
  return rest as Omit<T, "id">;
}

export function transform(project: Project): Record<string, string> {
  const files: Record<string, string> = {};

  const yamlOpts = { lineWidth: 0 };

  // Id DISQUE : ces chemins sont écrits tels quels sur le serveur, qui range
  // le project sous son propre nom de dossier (cf. `Project.diskId`).
  const base = `plugins/Artisan/projects/${project.diskId ?? project.id}`;

  for (const menu of project.menus) {
    files[`${base}/menus/${menu.id}.yaml`] = stringify(
      withoutId(serializeMenuToV1(menu, project)),
      yamlOpts,
    );
  }

  for (const cmd of project.commands) {
    files[`${base}/commands/${cmd.id}.yaml`] = stringify(
      withoutId(serializeCommand(cmd, project)),
      yamlOpts,
    );
  }

  for (const dialog of project.dialogs) {
    files[`${base}/dialogs/${dialog.id}.yaml`] = stringify(
      withoutId(serializeDialog(dialog, project)),
      yamlOpts,
    );
  }

  // Captured items: the opaque serialized stack is the runtime truth — emit it
  // VERBATIM (never parse/re-stringify), one file per item. The plugin
  // deserializes these to resolve `item:<id>` material refs with exact NBT.
  for (const item of project.capturedItems ?? []) {
    files[`${base}/items/${item.id}.yml`] = item.stackYaml;
  }

  const claimedModelIds = emitDataSources(project, base, files, yamlOpts);

  const langs = listLanguages(project);
  const referencedKeys = collectReferencedKeys(project);
  const dsI18n = dataSourceI18n(project);
  for (const lang of langs) {
    // Inline mode: the default language IS the documents, so a `lang/<default>`
    // file would be a second copy of the same truth (same rule data sources
    // already follow, ADR bare-data-files ④) — except for SITELESS keys, which no
    // document can hold. Those still need a home, so the file is emitted with
    // them alone.
    if (project.i18nMode === "inline" && lang === project.defaultLang) {
      const siteless = serializeLang(project, lang, new Set(SITELESS_KEYS));
      if (Object.keys(siteless).length > 0) {
        files[`${base}/lang/${lang}.yaml`] = stringify(nestLangTree(siteless), yamlOpts);
      }
      continue;
    }
    // Written as a YAML tree, not one dotted key per line — `nestLangTree`
    // re-sorts every level in byte order so the file stays deterministic.
    files[`${base}/lang/${lang}.yaml`] = stringify(
      nestLangTree(
        serializeLang(
          project,
          lang,
          referencedKeys,
          lang === project.defaultLang ? {} : (dsI18n.byLang[lang] ?? {}),
        ),
      ),
      yamlOpts,
    );
  }

  const liveIds = new Set<string>([
    ...project.menus.map((m) => m.id as string),
    ...project.commands.map((c) => c.id as string),
    ...project.dialogs.map((d) => d.id as string),
  ]);
  const editorLayout = Object.fromEntries(
    Object.entries(project.canvasLayout).filter(([id]) => liveIds.has(id)),
  );

  const manifest: Record<string, unknown> = {
    schema: "manifest/v1",
    // Round-trip the Add-on owner id (ADR addon-owned-project-roots) so it survives
    // an editor save — the backend re-derives `ownerModule` from it.
    ...(project.ownerModule ? { module: project.ownerModule } : {}),
    default_lang: project.defaultLang,
    languages: langs,
    // Plus de bloc `files:` : il recopiait le contenu de menus/, commands/ et
    // dialogs/ sans y ajouter ni ordre de chargement ni exclusion — un index à
    // tenir à jour à la main dont le seul effet possible était de se
    // désynchroniser. Les Documents sont découverts par scan, des deux côtés.
  };
  // Data models: models/<id>.yaml (model/v1), fields VERBATIM (cross-model refs
  // preserved) — the lossless editor store. data/<id>.yaml stays denormalized
  // and self-contained for the runtime; the plugin ignores models/ entirely.
  // Module-DECLARED models are NOT project content — their truth is the
  // declaration (Presence), never a project file (ADR composable-data-models §4).
  for (const m of project.dataModels ?? []) {
    if (m.provenance === "module") continue;
    // Owned by a source (doc emitted at models/<sourceId>.yaml, or an untyped
    // synthesized model with nothing to say) — ADR bare-data-files ⑤.
    if (claimedModelIds.has(String(m.id))) continue;
    files[`${base}/models/${m.id}.yaml`] = stringify(
      {
        schema: "model/v1",
        id: m.id,
        name: m.name,
        key_field: m.keyField,
        ...(m.masterDetail ? { master_detail: true } : {}),
        fields: m.fields,
      },
      yamlOpts,
    );
  }
  // Editor presentation state (board layout/edges) lives in the hash-excluded
  // `.artisan/editor.yaml` — NOT in the manifest — so cosmetic board moves no
  // longer change the bundle hash and redeploy the server (ADR
  // files-first-source-of-truth #3).
  const editorEdges = Object.fromEntries(
    Object.entries(project.canvasEdges ?? {}).filter(([edgeId, v]) => {
      const [src, tgt] = edgeId.split("->") as [string, string];
      return liveIds.has(src) && liveIds.has(tgt) && (v.from || v.to);
    }),
  );
  const editorState: Record<string, unknown> = { schema: "editor-state/v1" };
  // The i18n mode is a presentation choice about the file shape, not project
  // content — it rides in the hash-excluded editor state so flipping it back
  // and forth doesn't churn the bundle hash on its own. Only written when it
  // departs from the default, so `extract` projects keep a clean tree.
  if (project.i18nMode === "inline") editorState.i18n_mode = "inline";
  if (Object.keys(editorLayout).length > 0) editorState.layout = editorLayout;
  if (Object.keys(editorEdges).length > 0) editorState.edges = editorEdges;
  // Captured item label + display descriptor: editor-only metadata, persisted
  // here and hash-excluded. The descriptor IS derivable from the stack now
  // (projectFromFiles falls back to parseCapturedStack), but it is still
  // written: it records what the capture panel showed, including a material
  // enriched by the plugin's custom-item reverse lookup. The user-given `name`
  // has no equivalent in the stack at all.
  if ((project.capturedItems ?? []).length > 0) {
    editorState.items = Object.fromEntries(
      (project.capturedItems ?? []).map((ci) => [ci.id, { name: ci.name, display: ci.display }]),
    );
  }
  if (Object.keys(editorState).length > 1) {
    files[`${base}/.artisan/editor.yaml`] = stringify(editorState, yamlOpts);
  }
  for (const [rel, content] of Object.entries(collectModuleExportFiles(project))) {
    files[`${base}/${rel}`] = content;
  }

  // Defensive: moduleData namespaces no registered module claims (e.g. user-auth
  // mode where module registration never ran) must not be silently dropped from
  // the deploy. Re-emit their raw `__files` verbatim. Namespaces already
  // normalized by a module (no `__files`) have nothing faithful to emit —
  // documented limitation. Registered modules keep authority via exportFiles.
  for (const [ns, data] of Object.entries(project.moduleData ?? {})) {
    if (getModule(ns)) continue;
    const rawFiles = (data as { __files?: Record<string, string> } | null)?.__files;
    if (!rawFiles || typeof rawFiles !== "object") continue;
    for (const [rel, content] of Object.entries(rawFiles)) {
      files[`${base}/${ns}/${rel}`] = content;
    }
  }

  files[`${base}/manifest.yaml`] = stringify(manifest, yamlOpts);

  // No meta.yaml: nothing consumed it, and its `exported_at` timestamp made
  // every export a different byte tree (dirty hash on every save — removed
  // 2026-07-25). transform() is now a pure function of the Project.

  return files;
}
