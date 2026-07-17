import { collectModuleExportFiles, getModule } from "@artisan/editor-sdk";
import { getTitleTextLayers } from "@/domain/menuTitle";
import { walkActions } from "@/domain/stepPath";
import type {
  Action,
  Appearance,
  AssetId,
  Command,
  Condition,
  Dialog,
  DialogBody,
  DialogButton,
  DialogInput,
  Element,
  I18nKey,
  Layer,
  ItemTemplate,
  Menu,
  MenuTitleLayer,
  Project,
  Step,
} from "@/domain/types";
import { slotCount } from "@/features/canvas/inventoryTypes";
import { listLanguages } from "@/lib/i18nUsages";
import { stringify } from "yaml";

const i18nRef = (key: string): string => `{i18n:${key}}`;

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

function serializeAction(action: Action): unknown {
  switch (action.type) {
    case "open_menu": {
      const out: Record<string, unknown> = { type: "open_menu", menu_id: action.menuId };
      if (action.clearContext) out.clear_context = true;
      if (action.context) out.context = action.context;
      return out;
    }
    case "send_message":
      return { type: "send_message", text: i18nRef(action.text.key) };
    case "show_title": {
      const out: Record<string, unknown> = { type: "show_title", title: i18nRef(action.title.key) };
      if (action.subtitle) out.subtitle = i18nRef(action.subtitle.key);
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
      return { type: "broadcast", text: i18nRef(action.text.key) };
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

function serializeStep(step: Step, pack: Project): unknown {
  if (step.kind === "action") {
    return { kind: "action", action: serializeAction(step.action) };
  }
  const out: Record<string, unknown> = {
    kind: "if",
    cases: step.cases.map((c) => ({
      conditions: c.conditions.map(serializeCondition),
      ...(c.joins ? { joins: c.joins } : {}),
      steps: c.steps.map((s) => serializeStep(s, pack)),
    })),
  };
  if (step.else) {
    out.else = step.else.map((s) => serializeStep(s, pack));
  }
  return out;
}

function serializeSteps(steps: Step[], pack: Project): unknown[] {
  return steps.map((s) => serializeStep(s, pack));
}

// ─── appearance serialization ────────────────────────────────────────────────

function serializeAppearance(app: Appearance, pack: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (app.if && app.if.length > 0) out.if = serializeIfArray(app.if, app.ifJoins);
  if (app.material) out.material = app.material;
  if (app.head) out.head = app.head;
  if (app.count !== undefined) out.count = app.count;
  if (app.title) out.title = i18nRef(app.title.key);
  if (app.lore) out.lore = [i18nRef(app.lore.key)];
  if (app.click) {
    const clickOut: Record<string, unknown> = {};
    for (const [clickType, handler] of Object.entries(app.click)) {
      if (!handler) continue;
      clickOut[clickType] = { steps: serializeSteps(handler.steps, pack) };
    }
    if (Object.keys(clickOut).length > 0) out.click = clickOut;
  }
  return out;
}

// ─── element serialization ───────────────────────────────────────────────────

/** Resolve an element's bound Item template, or null (unbound / dangling ref). */
function boundTemplate(el: Element, pack: Project): ItemTemplate | null {
  const tplId = el.places?.templateId ?? el.iterates?.templateId;
  if (!tplId) return null;
  return (pack.itemTemplates ?? []).find((t) => t.id === tplId) ?? null;
}

/**
 * Serialize an element. When bound to an Item template, the template is
 * **inlined**: its appearances replace the element's, and its alias (and
 * `keyField` for placement mode) win over the element's local fields — so
 * `menu/v1` and the plugin never see templates, and editing a template
 * propagates to every consuming menu at the next deploy. A dangling
 * `templateId` falls back to the element's local fields (non-hermetic).
 */
function serializeElement(el: Element, pack: Project): Record<string, unknown> {
  const tpl = boundTemplate(el, pack);
  const appearances = tpl ? tpl.appearances : el.appearances;
  const out: Record<string, unknown> = {
    id: el.id,
    positions: el.positions,
    appearances: appearances.map((a) => serializeAppearance(a, pack)),
  };
  if (el.iterates) {
    out.iterates = { source: el.iterates.source, alias: tpl?.alias ?? el.iterates.alias };
  }
  if (el.places) {
    // `key_field` is snake_case on the wire (plugin PlacesYaml); cachedDisplay is
    // editor-only (offline render fallback) and never exported to the bundle.
    out.places = {
      source: el.places.source,
      alias: tpl?.alias ?? el.places.alias,
      key_field: tpl?.keyField ?? el.places.keyField,
      placements: el.places.placements.map((p) => ({
        key: p.key,
        page: p.page,
        position: p.position,
      })),
    };
  }
  if (el.tags && el.tags.length > 0) out.tags = el.tags;
  return out;
}

// ─── layer serialization ─────────────────────────────────────────────────────

function serializeLayer(layer: Layer, pack: Project): Record<string, unknown> {
  return {
    id: layer.id,
    name: layer.name,
    elements: layer.elements.map((el) => serializeElement(el, pack)),
  };
}

// ─── title layer serialization ───────────────────────────────────────────────

function serializeTitleLayer(layer: MenuTitleLayer): Record<string, unknown> {
  if (layer.kind === "background") {
    return { kind: "background", asset_id: layer.assetId };
  }
  if (layer.kind === "glyph") {
    return { kind: "glyph", asset_id: layer.assetId, x: layer.x, y: layer.y };
  }
  if (layer.kind === "text") {
    const out: Record<string, unknown> = {
      kind: "text",
      value: { key: layer.value.key },
      x: layer.x,
      y: layer.y,
    };
    if (layer.color !== undefined) out.color = layer.color;
    if (layer.fontAssetId !== undefined) out.font_asset_id = layer.fontAssetId;
    if (layer.size !== undefined && layer.size !== 8) out.size = layer.size;
    return out;
  }
  if (layer.kind === "plain") {
    // Plain (vanilla) layers serialize to a { kind, value } map like every
    // other layer; the title is always emitted as a layer array (canonical
    // menu/v1 — no legacy plain-only string shortcut).
    const out: Record<string, unknown> = { kind: "plain", value: { key: layer.value.key } };
    if (layer.color !== undefined) out.color = layer.color;
    return out;
  }
  if (layer.kind === "textarea") {
    const out: Record<string, unknown> = {
      kind: "textarea",
      value: { key: layer.value.key },
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
    // Legacy string format → plain vanilla layer (no resource pack needed).
    return [{ kind: "plain", value: { key: node as I18nKey } }];
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

function parseTitleLayer(node: unknown): MenuTitleLayer | null {
  if (!node || typeof node !== "object") return null;
  const m = node as Record<string, unknown>;
  switch (m.kind) {
    case "background":
      if (typeof m.asset_id !== "string") return null;
      return { kind: "background", assetId: m.asset_id as AssetId };
    case "glyph":
      if (typeof m.asset_id !== "string") return null;
      return {
        kind: "glyph",
        assetId: m.asset_id as AssetId,
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
      };
    case "text": {
      const value = m.value;
      let key: I18nKey | undefined;
      if (
        value &&
        typeof value === "object" &&
        typeof (value as { key?: unknown }).key === "string"
      ) {
        key = (value as { key: string }).key as I18nKey;
      }
      if (!key) return null;
      const out: MenuTitleLayer = {
        kind: "text",
        value: { key },
        x: typeof m.x === "number" ? m.x : LEGACY_TEXT_X,
        y: typeof m.y === "number" ? m.y : LEGACY_TEXT_Y,
      };
      if (typeof m.color === "string") out.color = m.color;
      if (typeof m.font_asset_id === "string") out.fontAssetId = m.font_asset_id as AssetId;
      if (typeof m.size === "number" && [8, 12, 16, 20, 24, 32].includes(m.size)) {
        out.size = m.size as 8 | 12 | 16 | 20 | 24 | 32;
      }
      return out;
    }
    case "plain": {
      const value = m.value;
      let key: I18nKey | undefined;
      if (
        value &&
        typeof value === "object" &&
        typeof (value as { key?: unknown }).key === "string"
      ) {
        key = (value as { key: string }).key as I18nKey;
      }
      if (!key) return null;
      const out: MenuTitleLayer = { kind: "plain", value: { key } };
      if (typeof m.color === "string") out.color = m.color;
      return out;
    }
    case "textarea": {
      const value = m.value;
      let key: I18nKey | undefined;
      if (
        value &&
        typeof value === "object" &&
        typeof (value as { key?: unknown }).key === "string"
      ) {
        key = (value as { key: string }).key as I18nKey;
      }
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
      if (typeof m.font_asset_id === "string") out.fontAssetId = m.font_asset_id as AssetId;
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
 * the AI assistant (`packToMenuV1`) *and* the internal file exporter
 * (`transform()`), so the wire shape stays single-sourced.
 */
export function serializeMenuToV1(
  menu: Menu,
  pack: Project,
): { id: string } & Record<string, unknown> {
  const type = menu.inventoryType ?? "chest";
  const out: Record<string, unknown> = {
    schema: "menu/v1",
    id: menu.id,
    title: menu.title.map(serializeTitleLayer),
    size: slotCount(type, menu.rows),
    layers: menu.layers.map((l) => serializeLayer(l, pack)),
  };
  if (type !== "chest") out.inventory_type = type;
  if (menu.permission) out.permission = menu.permission;
  if (menu.notes) out.notes = menu.notes;
  if (menu.contextInputs && menu.contextInputs.length > 0) {
    out.context_inputs = menu.contextInputs.map((ci) => {
      if (ci.kind === "primitive") {
        const c: Record<string, unknown> = { name: ci.name, type: ci.type };
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

/** Serialize every menu in a pack to canonical `menu/v1` objects (one per menu). */
export function packToMenuV1(pack: Project): ({ id: string } & Record<string, unknown>)[] {
  return pack.menus.map((m) => serializeMenuToV1(m, pack));
}

// ─── command serialization ───────────────────────────────────────────────────

export function serializeCommand(cmd: Command, pack: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema: "command/v1",
    id: cmd.id,
    name: cmd.name,
    steps: serializeSteps(cmd.steps, pack),
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

/** Serialize every command in a pack to canonical command/v1 objects. */
export function packToCommandV1(pack: Project): Record<string, unknown>[] {
  return pack.commands.map((c) => serializeCommand(c, pack));
}

// ─── dialog serialization ────────────────────────────────────────────────────

function extractFlatActions(steps: Step[]): unknown[] {
  const result: unknown[] = [];
  for (const step of steps) {
    if (step.kind === "action") result.push(serializeAction(step.action));
    // if-branches not supported in dialog button v1 export
  }
  return result;
}

function serializeDialogBody(body: DialogBody): Record<string, unknown> {
  if (body.type === "text") return { type: "text", text: i18nRef(body.text.key) };
  return { type: "item", material: body.material, count: body.count };
}

function serializeDialogInput(input: DialogInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    label: i18nRef(input.label.key),
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
    out.options = input.options.map((opt) => ({ value: opt.value, label: i18nRef(opt.label.key) }));
    out.default = input.default;
  }
  return out;
}

function serializeDialogButton(btn: DialogButton): Record<string, unknown> {
  const out: Record<string, unknown> = { id: btn.id, label: i18nRef(btn.label.key) };
  const actions = extractFlatActions(btn.steps);
  if (actions.length > 0) out.actions = actions;
  return out;
}

export function serializeDialog(dialog: Dialog): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema: "dialog/v1",
    id: dialog.id,
    title: i18nRef(dialog.title.key),
  };
  if (!dialog.canCloseWithEscape) out.can_close_with_escape = false;
  if (dialog.body.length > 0) out.body = dialog.body.map(serializeDialogBody);
  if (dialog.inputs.length > 0) out.inputs = dialog.inputs.map(serializeDialogInput);
  out.buttons = dialog.buttons.map(serializeDialogButton);
  return out;
}

/** Serialize every dialog in a pack to canonical dialog/v1 objects. */
export function packToDialogV1(pack: Project): Record<string, unknown>[] {
  return pack.dialogs.map((d) => serializeDialog(d));
}

// ─── translations serialization ──────────────────────────────────────────────

function addActionKeys(action: Action, keys: Set<string>): void {
  if (action.type === "send_message" || action.type === "broadcast") keys.add(action.text.key);
  else if (action.type === "show_title") {
    keys.add(action.title.key);
    if (action.subtitle) keys.add(action.subtitle.key);
  }
}

function collectReferencedKeys(pack: Project): Set<string> {
  const keys = new Set<string>();
  for (const menu of pack.menus) {
    for (const lt of getTitleTextLayers(menu)) keys.add(lt.key);
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        for (const app of el.appearances) {
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
  for (const cmd of pack.commands) {
    for (const action of walkActions(cmd.steps)) addActionKeys(action, keys);
  }
  for (const dialog of pack.dialogs) {
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
  return keys;
}

function serializeLang(
  pack: Project,
  lang: string,
  referencedKeys: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Iterate `referencedKeys` (not `pack.i18nKeys`) so we always emit *every*
  // key the runtime will look up — even ones that have never been assigned a
  // value. Otherwise a freshly-created menu with no title typed yet yields a
  // missing key in the YAML, and the plugin falls back to printing the raw
  // key (`menus.foo.title`) to chat instead of nothing.
  for (const key of referencedKeys) {
    const entry = pack.i18nKeys[key as keyof typeof pack.i18nKeys];
    const val = entry?.[lang];
    if (val !== undefined) {
      out[key] = val;
    } else if (lang === pack.defaultLang) {
      // Always seed the defaultLang file with an empty string so the runtime
      // resolves the key to "" rather than echoing the raw key.
      out[key] = "";
    }
  }
  return out;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Transform a Project into a flat map of filename → YAML string.
 * Keys use the server-side path (e.g. "plugins/Artisan/menus/shop_main.yaml").
 */
export function transform(pack: Project): Record<string, string> {
  const files: Record<string, string> = {};

  const yamlOpts = { lineWidth: 0 };

  const base = `plugins/Artisan/projects/${pack.id}`;

  for (const menu of pack.menus) {
    files[`${base}/menus/${menu.id}.yaml`] = stringify(serializeMenuToV1(menu, pack), yamlOpts);
  }

  for (const cmd of pack.commands) {
    files[`${base}/commands/${cmd.id}.yaml`] = stringify(serializeCommand(cmd, pack), yamlOpts);
  }

  for (const dialog of pack.dialogs) {
    files[`${base}/dialogs/${dialog.id}.yaml`] = stringify(serializeDialog(dialog), yamlOpts);
  }

  // Captured items: the opaque serialized stack is the runtime truth — emit it
  // VERBATIM (never parse/re-stringify), one file per item. The plugin
  // deserializes these to resolve `item:<id>` material refs with exact NBT.
  for (const item of pack.capturedItems ?? []) {
    files[`${base}/items/${item.id}.yml`] = item.stackYaml;
  }

  const langs = listLanguages(pack);
  const referencedKeys = collectReferencedKeys(pack);
  for (const lang of langs) {
    files[`${base}/lang/${lang}.yaml`] = stringify(
      serializeLang(pack, lang, referencedKeys),
      yamlOpts,
    );
  }

  const liveIds = new Set<string>([
    ...pack.menus.map((m) => m.id as string),
    ...pack.commands.map((c) => c.id as string),
    ...pack.dialogs.map((d) => d.id as string),
  ]);
  const editorLayout = Object.fromEntries(
    Object.entries(pack.canvasLayout).filter(([id]) => liveIds.has(id)),
  );

  const manifest: Record<string, unknown> = {
    schema: "manifest/v1",
    project_id: pack.id,
    default_lang: pack.defaultLang,
    languages: langs,
    files: {
      menus: pack.menus.map((m) => m.id),
      commands: pack.commands.map((c) => c.id),
      dialogs: pack.dialogs.map((d) => d.id),
    },
  };
  if (Object.keys(editorLayout).length > 0) {
    manifest.editor_layout = editorLayout;
  }
  const editorEdges = Object.fromEntries(
    Object.entries(pack.canvasEdges ?? {}).filter(([edgeId, v]) => {
      const [src, tgt] = edgeId.split("->") as [string, string];
      return liveIds.has(src) && liveIds.has(tgt) && (v.from || v.to);
    }),
  );
  if (Object.keys(editorEdges).length > 0) {
    manifest.editor_edges = editorEdges;
  }
  for (const [rel, content] of Object.entries(collectModuleExportFiles(pack))) {
    files[`${base}/${rel}`] = content;
  }

  // Defensive: moduleData namespaces no registered module claims (e.g. user-auth
  // mode where module registration never ran) must not be silently dropped from
  // the deploy. Re-emit their raw `__files` verbatim. Namespaces already
  // normalized by a module (no `__files`) have nothing faithful to emit —
  // documented limitation. Registered modules keep authority via exportFiles.
  for (const [ns, data] of Object.entries(pack.moduleData ?? {})) {
    if (getModule(ns)) continue;
    const rawFiles = (data as { __files?: Record<string, string> } | null)?.__files;
    if (!rawFiles || typeof rawFiles !== "object") continue;
    for (const [rel, content] of Object.entries(rawFiles)) {
      files[`${base}/${ns}/${rel}`] = content;
    }
  }

  files[`${base}/manifest.yaml`] = stringify(manifest, yamlOpts);

  files[`${base}/meta.yaml`] = stringify(
    {
      project_id: pack.id,
      exported_at: new Date().toISOString(),
      editor_version: "1.0.0",
    },
    yamlOpts,
  );

  return files;
}
