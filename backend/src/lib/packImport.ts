import { parse as parseYaml } from "yaml";

// ─── i18n helper ─────────────────────────────────────────────────────────────

/** Convert "{i18n:some.key}" → { key: "some.key" }. Fallback: { key: raw }. */
function ltext(raw: unknown): { key: string } {
  if (typeof raw !== "string") return { key: "" };
  const m = raw.match(/^\{i18n:(.+)\}$/);
  return { key: m ? m[1] : raw };
}

// ─── action/step inverse ──────────────────────────────────────────────────────

function importAction(a: Record<string, unknown>): unknown {
  switch (a.type) {
    case "open_menu": {
      const out: Record<string, unknown> = { type: "open_menu", menuId: a.menu_id };
      if (a.clear_context) out.clearContext = true;
      if (a.context) out.context = a.context;
      return out;
    }
    case "open_dialog": {
      const out: Record<string, unknown> = { type: "open_dialog", dialogId: a.dialog_id };
      if (a.clear_context) out.clearContext = true;
      if (a.context) out.context = a.context;
      return out;
    }
    case "send_message":
      return { type: "send_message", text: ltext(a.text) };
    case "run_command":
      return { type: "run_command", command: a.command, as: a.as };
    case "close_menu":
      return { type: "close_menu" };
    case "close_dialog":
      return { type: "close_dialog" };
    case "give_item":
      return { type: "give_item", material: a.material, count: a.count };
    case "take_money":
      return { type: "take_money", amount: a.amount };
    case "paginate": {
      const out: Record<string, unknown> = { type: "paginate", direction: a.direction };
      if (a.target_element_id) out.targetElementId = a.target_element_id;
      return out;
    }
    case "set_arg":
      return { type: "set_arg", arg: a.arg, value: a.value };
    case "set_arg_cycle_next":
      return { type: "set_arg_cycle_next", arg: a.arg, list: a.list };
    case "set_arg_cycle_prev":
      return { type: "set_arg_cycle_prev", arg: a.arg, list: a.list };
    default:
      return a;
  }
}

function importStep(s: Record<string, unknown>): unknown {
  if (s.kind === "action") {
    return { kind: "action", action: importAction(s.action as Record<string, unknown>) };
  }
  if (s.kind === "if") {
    const cases = ((s.cases as Record<string, unknown>[]) ?? []).map((c) => ({
      conditions: c.conditions ?? [],
      ...(c.joins ? { joins: c.joins } : {}),
      steps: ((c.steps as Record<string, unknown>[]) ?? []).map(importStep),
    }));
    const out: Record<string, unknown> = { kind: "if", cases };
    if (s.else) {
      out.else = ((s.else as Record<string, unknown>[]) ?? []).map(importStep);
    }
    return out;
  }
  return s;
}

function importSteps(steps: unknown): unknown[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => importStep(s as Record<string, unknown>));
}

// ─── flat actions → steps (dialog buttons use `actions:` not `steps:`) ────────

function actionsToSteps(actions: unknown): unknown[] {
  if (!Array.isArray(actions)) return [];
  return actions.map((a) => ({ kind: "action", action: importAction(a as Record<string, unknown>) }));
}

// ─── dialog sub-types ─────────────────────────────────────────────────────────

function importDialogBody(b: Record<string, unknown>): unknown {
  if (b.type === "text") return { type: "text", text: ltext(b.text) };
  if (b.type === "item") return { type: "item", material: b.material, count: b.count };
  return b;
}

function importDialogInput(i: Record<string, unknown>): unknown {
  const base = { id: i.id, type: i.type, label: ltext(i.label) };
  switch (i.type) {
    case "text":
      return { ...base, default: i.default ?? "", maxLength: i.max_length ?? 32 };
    case "bool":
      return { ...base, default: String(i.default) === "true" };
    case "number_range":
      return { ...base, min: i.min ?? 0, max: i.max ?? 100, default: Number(i.default ?? 0) };
    case "single_option": {
      const options = ((i.options as Record<string, unknown>[]) ?? []).map((o) => ({
        value: o.value,
        label: ltext(o.label),
      }));
      return { ...base, options, default: i.default ?? "" };
    }
    default:
      return base;
  }
}

function importDialogButton(b: Record<string, unknown>): unknown {
  return {
    id: b.id,
    label: ltext(b.label),
    steps: actionsToSteps(b.actions),
  };
}

// ─── YAML schema types ────────────────────────────────────────────────────────

interface ManifestYaml {
  pack_id?: string;
  default_lang?: string;
  files?: { menus?: string[]; commands?: string[]; dialogs?: string[] };
  editor_layout?: Record<string, unknown>;
}

interface CommandYaml {
  id?: string;
  name?: string;
  aliases?: string[];
  permission?: string;
  description?: string;
  arguments?: Array<{ name: string; type?: string; required?: boolean; default?: string }>;
  steps?: unknown[];
}

interface MenuYaml {
  id?: string;
  title?: string;
  size?: number;
  rows?: number;
  layers?: unknown[];
}

interface DialogYaml {
  id?: string;
  title?: string;
  can_close_with_escape?: boolean;
  body?: Record<string, unknown>[];
  inputs?: Record<string, unknown>[];
  buttons?: Record<string, unknown>[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function getFile(files: Record<string, string>, packId: string, rel: string): string | null {
  return files[`plugins/Artisan/packs/${packId}/${rel}`] ?? null;
}

function tryParse<T>(text: string | null): T | null {
  if (!text) return null;
  try { return parseYaml(text) as T; } catch { return null; }
}

// ─── editor layout ───────────────────────────────────────────────────────────

function parseEditorLayout(raw: unknown): Record<string, { x: number; y: number }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const { x, y } = v as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[id] = { x, y };
  }
  return out;
}

export function readEditorLayoutFromFiles(
  files: Record<string, string>,
  packId: string,
): Record<string, { x: number; y: number }> {
  const m = tryParse<ManifestYaml>(getFile(files, packId, "manifest.yaml")) ?? {};
  return parseEditorLayout(m.editor_layout);
}

// ─── public API ───────────────────────────────────────────────────────────────

export function importPackFromFiles(packId: string, files: Record<string, string>): Record<string, unknown> {
  const manifest = tryParse<ManifestYaml>(getFile(files, packId, "manifest.yaml")) ?? {};
  const defaultLang = manifest.default_lang ?? "en";
  const commandIds  = manifest.files?.commands ?? [];
  const dialogIds   = manifest.files?.dialogs  ?? [];
  const menuIds     = manifest.files?.menus    ?? [];
  const now         = new Date().toISOString();

  const commands = commandIds.map((cmdId) => {
    const y = tryParse<CommandYaml>(getFile(files, packId, `commands/${cmdId}.yaml`)) ?? {};
    return {
      id: y.id ?? cmdId,
      packId,
      name: y.name ?? cmdId,
      aliases: y.aliases ?? [],
      permission: y.permission,
      description: y.description,
      arguments: (y.arguments ?? []).map((a) => ({
        name: a.name,
        type: a.type ?? "string",
        required: a.required ?? false,
        ...(a.default !== undefined ? { default: a.default } : {}),
      })),
      steps: importSteps(y.steps),
    };
  });

  const dialogs = dialogIds.map((dlgId) => {
    const y = tryParse<DialogYaml>(getFile(files, packId, `dialogs/${dlgId}.yaml`)) ?? {};
    return {
      id: y.id ?? dlgId,
      packId,
      title: ltext(y.title ?? `{i18n:dialogs.${dlgId}.title}`),
      canCloseWithEscape: y.can_close_with_escape ?? true,
      body: (y.body ?? []).map(importDialogBody),
      inputs: (y.inputs ?? []).map(importDialogInput),
      buttons: (y.buttons ?? []).map(importDialogButton),
    };
  });

  const menus = menuIds.map((menuId) => {
    const y = tryParse<MenuYaml>(getFile(files, packId, `menus/${menuId}.yaml`)) ?? {};
    const rows = y.rows ?? (y.size ? Math.max(1, Math.min(6, Math.ceil(y.size / 9))) : 3);
    return {
      id: y.id ?? menuId,
      packId,
      title: ltext(y.title ?? `{i18n:menus.${menuId}.title}`),
      rows: rows as 1 | 2 | 3 | 4 | 5 | 6,
      layers: Array.isArray(y.layers) ? y.layers : [{ id: "layer_default", name: "Default", elements: [] }],
    };
  });

  return {
    id: packId,
    name: packId,
    source: "imported",
    createdAt: now,
    updatedAt: now,
    menus,
    commands,
    templates: [],
    assets: [],
    dataSources: [],
    dialogs,
    importedConnectors: [],
    i18nKeys: {},
    defaultLang,
    canvasLayout: parseEditorLayout(manifest.editor_layout),
  };
}

/** Returns true if the editorJson looks like an auto-generated empty stub. */
export function isEmptyStub(editorJson: string | null | undefined): boolean {
  if (!editorJson) return true;
  try {
    const p = JSON.parse(editorJson) as {
      source?: string;
      menus?: unknown[];
      commands?: Array<{ steps?: unknown[] }>;
      dialogs?: Array<{ body?: unknown[]; inputs?: unknown[]; buttons?: unknown[] }>;
    };

    // Completely empty
    if ((p.menus?.length ?? 0) === 0 && (p.commands?.length ?? 0) === 0 && (p.dialogs?.length ?? 0) === 0)
      return true;

    // Imported stub where every command has empty steps and every dialog has empty body/inputs/buttons.
    // This catches packs imported before full YAML parsing was implemented.
    if (p.source === "imported") {
      const allCmdsEmpty = (p.commands ?? []).every((c) => (c.steps?.length ?? 0) === 0);
      const allDlgsEmpty = (p.dialogs ?? []).every(
        (d) => (d.body?.length ?? 0) === 0 && (d.inputs?.length ?? 0) === 0 && (d.buttons?.length ?? 0) === 0,
      );
      if (allCmdsEmpty && allDlgsEmpty) return true;
    }

    return false;
  } catch { return true; }
}
