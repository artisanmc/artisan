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
  Menu,
  MenuTitleLayer,
  Pack,
  Step,
} from "@/domain/types";
import { listLanguages } from "@/lib/i18nUsages";
import { stringify } from "yaml";

const i18nRef = (key: string): string => `{i18n:${key}}`;

// ─── condition serialization ────────────────────────────────────────────────
// Conditions are already snake_case and contain no LText — pass through as-is.

function serializeCondition(c: Condition): unknown {
  if (c.type === "not") return { type: "not", of: serializeCondition(c.of) };
  if (c.type === "and") return { type: "and", all: (c.of as Condition[]).map(serializeCondition) };
  if (c.type === "or") return { type: "or", any: (c.of as Condition[]).map(serializeCondition) };
  return c;
}

function collapseConditions(conditions: Condition[], joins?: ("and" | "or")[]): unknown {
  // biome-ignore lint/style/noNonNullAssertion: length === 1 guarantees [0] exists
  if (conditions.length === 1) return serializeCondition(conditions[0]!);
  const op = joins?.[0] ?? "and";
  const items = conditions.map(serializeCondition);
  return op === "or" ? { type: "or", any: items } : { type: "and", all: items };
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
    case "run_command":
      return { type: "run_command", command: action.command, as: action.as };
    case "close_menu":
      return { type: "close_menu" };
    case "give_item":
      return { type: "give_item", material: action.material, count: action.count };
    case "take_money":
      return { type: "take_money", amount: action.amount };
    case "paginate": {
      const out: Record<string, unknown> = { type: "paginate", direction: action.direction };
      if (action.targetElementId) out.target_element_id = action.targetElementId;
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

function serializeStep(step: Step, pack: Pack): unknown {
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

function serializeSteps(steps: Step[], pack: Pack): unknown[] {
  return steps.map((s) => serializeStep(s, pack));
}

// ─── appearance serialization ────────────────────────────────────────────────

function serializeAppearance(app: Appearance, pack: Pack): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (app.if && app.if.length > 0) out.if = collapseConditions(app.if, app.ifJoins);
  if (app.material) out.material = app.material;
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

function serializeElement(el: Element, pack: Pack): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: el.id,
    positions: el.positions,
    appearances: el.appearances.map((a) => serializeAppearance(a, pack)),
  };
  if (el.iterates) out.iterates = el.iterates;
  if (el.tags && el.tags.length > 0) out.tags = el.tags;
  return out;
}

// ─── layer serialization ─────────────────────────────────────────────────────

function serializeLayer(layer: Layer, pack: Pack): Record<string, unknown> {
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
    return out;
  }
  if (layer.kind === "plain") {
    // Plain layers are serialized as arrays when mixed with other layers,
    // but serializeMenu short-circuits to legacy string format when the
    // title is plain-only (see serializeMenu). This path is a fallback.
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
      if (value && typeof value === "object" && typeof (value as { key?: unknown }).key === "string") {
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
      return out;
    }
    case "plain": {
      const value = m.value;
      let key: I18nKey | undefined;
      if (value && typeof value === "object" && typeof (value as { key?: unknown }).key === "string") {
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
      if (value && typeof value === "object" && typeof (value as { key?: unknown }).key === "string") {
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

function serializeMenu(menu: Menu, pack: Pack): Record<string, unknown> {
  // Plain (vanilla) mode: export as legacy string format so any server can use
  // it without a resource pack. Single plain layer → "{i18n:key}" string.
  const plainOnly = menu.title.length > 0 && menu.title.every((l) => l.kind === "plain");
  const titleField = plainOnly
    ? i18nRef((menu.title[0] as Extract<(typeof menu.title)[number], { kind: "plain" }>).value.key)
    : menu.title.map(serializeTitleLayer);

  const out: Record<string, unknown> = {
    schema: "menu/v1",
    id: menu.id,
    title: titleField,
    size: menu.rows * 9,
    layers: menu.layers.map((l) => serializeLayer(l, pack)),
  };
  if (menu.permission) out.permission = menu.permission;
  if (menu.contextInputs && menu.contextInputs.length > 0) {
    out.context_inputs = menu.contextInputs.map((ci) => {
      if (ci.kind === "primitive") {
        const c: Record<string, unknown> = { name: ci.name, type: ci.type };
        if (ci.default !== undefined) c.default = ci.default;
        return c;
      }
      return { name: ci.name, ref: ci.ref };
    });
  }
  return out;
}

// ─── command serialization ───────────────────────────────────────────────────

function serializeCommand(cmd: Command, pack: Pack): Record<string, unknown> {
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
  const out: Record<string, unknown> = { id: input.id, type: input.type, label: i18nRef(input.label.key) };
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

function serializeDialog(dialog: Dialog): Record<string, unknown> {
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

// ─── translations serialization ──────────────────────────────────────────────

function collectReferencedKeys(pack: Pack): Set<string> {
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
              for (const action of walkActions(handler.steps)) {
                if (action.type === "send_message") keys.add(action.text.key);
              }
            }
          }
        }
      }
    }
  }
  for (const cmd of pack.commands) {
    for (const action of walkActions(cmd.steps)) {
      if (action.type === "send_message") keys.add(action.text.key);
    }
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
      for (const action of walkActions(btn.steps)) {
        if (action.type === "send_message") keys.add(action.text.key);
      }
    }
  }
  return keys;
}

function serializeLang(pack: Pack, lang: string, referencedKeys: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(pack.i18nKeys)) {
    if (!referencedKeys.has(key)) continue;
    if (!entry) continue;
    const val = entry[lang];
    if (val !== undefined) out[key] = val;
  }
  return out;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Transform a Pack into a flat map of filename → YAML string.
 * Keys use the server-side path (e.g. "plugins/Interfaze/menus/shop_main.yaml").
 */
export function transform(pack: Pack): Record<string, string> {
  const files: Record<string, string> = {};

  const yamlOpts = { lineWidth: 0 };

  const base = `plugins/Interfaze/packs/${pack.id}`;

  for (const menu of pack.menus) {
    files[`${base}/menus/${menu.id}.yaml`] = stringify(
      serializeMenu(menu, pack),
      yamlOpts,
    );
  }

  for (const cmd of pack.commands) {
    files[`${base}/commands/${cmd.id}.yaml`] = stringify(
      serializeCommand(cmd, pack),
      yamlOpts,
    );
  }

  for (const dialog of pack.dialogs) {
    files[`${base}/dialogs/${dialog.id}.yaml`] = stringify(serializeDialog(dialog), yamlOpts);
  }

  const langs = listLanguages(pack);
  const referencedKeys = collectReferencedKeys(pack);
  for (const lang of langs) {
    files[`${base}/lang/${lang}.yaml`] = stringify(serializeLang(pack, lang, referencedKeys), yamlOpts);
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
    pack_id: pack.id,
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
  files[`${base}/manifest.yaml`] = stringify(manifest, yamlOpts);

  files[`${base}/meta.yaml`] = stringify(
    {
      pack_id: pack.id,
      exported_at: new Date().toISOString(),
      editor_version: "1.0.0",
    },
    yamlOpts,
  );

  return files;
}
