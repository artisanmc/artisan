import { walkActions } from "@/domain/stepPath";
import type {
  Action,
  Appearance,
  Command,
  Condition,
  Element,
  Layer,
  Menu,
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
  if (c.type === "and") return { type: "and", of: (c.of as Condition[]).map(serializeCondition) };
  if (c.type === "or") return { type: "or", of: (c.of as Condition[]).map(serializeCondition) };
  return c;
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
  if (app.if && app.if.length > 0) out.if = app.if.map(serializeCondition);
  if (app.ifJoins && app.ifJoins.length > 0) out.if_joins = app.ifJoins;
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

// ─── menu serialization ──────────────────────────────────────────────────────

function serializeMenu(menu: Menu, pack: Pack): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema: "menu/v1",
    id: menu.id,
    title: i18nRef(menu.title.key),
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

// ─── translations serialization ──────────────────────────────────────────────

function collectReferencedKeys(pack: Pack): Set<string> {
  const keys = new Set<string>();
  for (const menu of pack.menus) {
    if (menu.title) keys.add(menu.title.key);
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

  const langs = listLanguages(pack);
  const referencedKeys = collectReferencedKeys(pack);
  for (const lang of langs) {
    files[`${base}/lang/${lang}.yaml`] = stringify(serializeLang(pack, lang, referencedKeys), yamlOpts);
  }

  files[`${base}/manifest.yaml`] = stringify(
    {
      schema: "manifest/v1",
      pack_id: pack.id,
      default_lang: pack.defaultLang,
      languages: langs,
      files: {
        menus: pack.menus.map((m) => m.id),
        commands: pack.commands.map((c) => c.id),
      },
    },
    yamlOpts,
  );

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
