import { parse as parseYaml } from "yaml";
// Action DSL codec (Phase 2 of ADR action-dsl): click-handler / command / dialog
// steps travel as a DSL STRING. We reuse the editor's pure parser directly — its
// only `@/…` imports are `import type` (erased at runtime), so there is no alias
// breakage (unlike domainSteps.ts, which runtime-imports `@/lib/i18n`). Keeping
// ONE TS parser avoids a hand-mirrored divergence the way the shared conformance
// fixtures avoid a TS↔Kotlin one.
import { parseActionDsl } from "../../../editor/src/lib/actionDsl/parser";
import type { DslAction, DslStep, DslText } from "../../../editor/src/lib/actionDsl/ast";

// This module mirrors the editor's YAML→domain converters so that a project
// seeded on disk (e.g. an add-on bootstrap) imports faithfully into editorJson.
// Reference implementations (source of truth for the domain shapes):
//   editor/src/schema/menuV1ToDomain.ts   (menu wire → domain)
//   editor/src/schema/actionV1ToDomain.ts (steps DSL string + conditions)
//   editor/src/features/export/transform.ts (domain → wire, the inverse)
// Conditions/menu sub-shapes are mirrored by hand; action-chain steps reuse the
// shared pure codec (above). Locked by editor/src/schema/projectImportRoundTrip.test.ts.

// ─── per-import i18n context ─────────────────────────────────────────────────

interface I18nCtx {
  defaultLang: string;
  /** key → { lang: value } read from lang/*.yaml. */
  translations: Record<string, Record<string, string>>;
  /** accumulated Project.i18nKeys (referenced + minted). */
  i18nKeys: Record<string, Record<string, string>>;
  unsupported: string[];
}

/** Mirror of editor newI18nKey() — opaque random key for literal text. */
function newI18nKey(): string {
  return `lt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** `{i18n:key}` reference → { key }, pulling its translations into i18nKeys. */
function ref(ctx: I18nCtx, key: string): { key: string } {
  const tr = ctx.translations[key];
  if (tr) ctx.i18nKeys[key] = { ...tr };
  return { key };
}

/** Literal text → freshly minted key valued in defaultLang (mirror of menuV1ToDomain.text). */
function text(ctx: I18nCtx, raw: unknown): { key: string } {
  const m = typeof raw === "string" ? /^\{i18n:(.+)\}$/.exec(raw) : null;
  if (m) return ref(ctx, m[1]!);
  const key = newI18nKey();
  ctx.i18nKeys[key] = { [ctx.defaultLang]: typeof raw === "string" ? raw : "" };
  return { key };
}

// ─── conditions (mirror of actionV1ToDomain) ─────────────────────────────────

// biome-ignore lint: untyped wire object — fields read by snake name
type Json = Record<string, any>;

function importCondition(ctx: I18nCtx, c: Json): unknown | null {
  if (!c || typeof c !== "object") {
    ctx.unsupported.push("condition: <malformed>");
    return null;
  }
  switch (c.type) {
    case "has_permission":
      return { type: "has_permission", perm: c.perm };
    case "has_money":
      return { type: "has_money", amount: c.amount };
    case "placeholder_equals":
      return { type: "placeholder_equals", placeholder: c.placeholder, value: c.value };
    case "placeholder_match":
      return { type: "placeholder_match", placeholder: c.placeholder, regex: c.regex };
    case "expression":
      return { type: "expression", expr: c.expr };
    case "has_item":
      return { type: "has_item", material: c.material, count: c.count ?? 1 };
    case "has_xp":
      return { type: "has_xp", amount: c.amount };
    case "has_level":
      return { type: "has_level", level: c.level };
    case "world_is":
      return { type: "world_is", world: c.world };
    case "time_is":
      return { type: "time_is", range: c.range };
    case "random_chance":
      return { type: "random_chance", probability: c.probability };
    case "cooldown_passed":
      return { type: "cooldown_passed", cooldown_id: c.cooldown_id };
    case "player_in_region":
      return { type: "player_in_region", region: c.region };
    case "pagination_at_first":
    case "pagination_at_last":
      return { type: c.type, ...(c.element_id ? { elementId: c.element_id } : {}) };
    case "not": {
      const of = importCondition(ctx, c.of);
      return of ? { type: "not", of } : null;
    }
    case "and":
    case "or":
      return {
        type: c.type,
        of: ((c.of as Json[]) ?? []).map((x) => importCondition(ctx, x)).filter(Boolean),
      };
    default:
      ctx.unsupported.push(`condition: ${c.type}`);
      return null;
  }
}

/** Appearance `if` array (ANDed) → domain if[] + ifJoins all "and". */
function importIfArray(
  ctx: I18nCtx,
  arr: Json[] | undefined,
): { conds: unknown[]; joins: "and"[] } | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const conds = arr.map((c) => importCondition(ctx, c)).filter(Boolean) as unknown[];
  if (conds.length === 0) return undefined;
  return { conds, joins: new Array(Math.max(0, conds.length - 1)).fill("and") };
}

// ─── action-chain steps (Action DSL string → domain Step[]) ──────────────────
// Click handlers, command bodies and dialog buttons carry a DSL STRING since
// Phase 2. The shared pure codec parses it to `DslStep[]`; here we only bridge
// DSL text (`@key` ref vs `"literal"`) to the i18n Key site. Non-text DslActions
// are already domain-shaped (ast.ts derives them from the domain Action union).

function dslTextToLText(ctx: I18nCtx, t: DslText): { key: string } {
  return "ref" in t ? ref(ctx, t.ref) : text(ctx, t.lit);
}

function dslActionToDomain(ctx: I18nCtx, a: DslAction): unknown {
  switch (a.type) {
    case "send_message":
      return { type: "send_message", text: dslTextToLText(ctx, a.text) };
    case "broadcast":
      return { type: "broadcast", text: dslTextToLText(ctx, a.text) };
    case "show_title":
      return {
        type: "show_title",
        title: dslTextToLText(ctx, a.title),
        ...(a.subtitle ? { subtitle: dslTextToLText(ctx, a.subtitle) } : {}),
        ...(a.fadeIn !== undefined ? { fadeIn: a.fadeIn } : {}),
        ...(a.stay !== undefined ? { stay: a.stay } : {}),
        ...(a.fadeOut !== undefined ? { fadeOut: a.fadeOut } : {}),
      };
    default:
      return a;
  }
}

function dslStepToDomain(ctx: I18nCtx, s: DslStep): unknown {
  if (s.kind === "action") return { kind: "action", action: dslActionToDomain(ctx, s.action) };
  return {
    kind: "if",
    cases: s.cases.map((c) => ({
      conditions: c.conditions,
      ...(c.joins ? { joins: c.joins } : {}),
      steps: c.steps.map((x) => dslStepToDomain(ctx, x)),
    })),
    ...(s.else ? { else: s.else.map((x) => dslStepToDomain(ctx, x)) } : {}),
  };
}

/** Action DSL string → domain Step[] (empty/blank/unparseable → []). */
function importSteps(ctx: I18nCtx, steps: unknown): unknown[] {
  if (typeof steps !== "string" || steps.trim() === "") return [];
  try {
    return parseActionDsl(steps).map((s) => dslStepToDomain(ctx, s));
  } catch (e) {
    ctx.unsupported.push(`steps: ${(e as Error).message}`);
    return [];
  }
}

// ─── menu sub-shapes (mirror of menuV1ToDomain) ──────────────────────────────

const TEXT_SIZES = [8, 12, 16, 20, 24, 32];
const CLICK_TYPES = ["left", "right", "shift_left", "shift_right", "middle"];

function importTitleLayer(ctx: I18nCtx, l: Json): unknown | null {
  switch (l.kind) {
    case "background":
      return { kind: "background", assetId: l.asset_id };
    case "glyph":
      return { kind: "glyph", assetId: l.asset_id, x: l.x, y: l.y };
    case "text": {
      const out: Json = { kind: "text", value: ref(ctx, l.value?.key ?? ""), x: l.x, y: l.y };
      if (l.color !== undefined) out.color = l.color;
      if (l.font_asset_id !== undefined) out.fontAssetId = l.font_asset_id;
      if (l.size !== undefined && TEXT_SIZES.includes(l.size)) out.size = l.size;
      return out;
    }
    case "plain": {
      const out: Json = { kind: "plain", value: ref(ctx, l.value?.key ?? "") };
      if (l.color !== undefined) out.color = l.color;
      return out;
    }
    case "textarea": {
      const out: Json = {
        kind: "textarea",
        value: ref(ctx, l.value?.key ?? ""),
        x: l.x,
        y: l.y,
        width: l.width,
        lineHeight: l.line_height,
        alignment: l.alignment,
      };
      if (l.font_asset_id !== undefined) out.fontAssetId = l.font_asset_id;
      if (l.size !== undefined && TEXT_SIZES.includes(l.size)) out.size = l.size;
      return out;
    }
    case "external_glyph":
      return { kind: "external_glyph", provider: l.provider, glyphName: l.glyph_name, x: l.x, y: l.y };
    default:
      ctx.unsupported.push(`title layer: ${l.kind}`);
      return null;
  }
}

/** Title node: layer array (canonical), bare string (legacy), or absent. */
function importTitle(ctx: I18nCtx, node: unknown, fallbackKey: string): unknown[] {
  if (Array.isArray(node)) {
    return node.map((l) => importTitleLayer(ctx, l as Json)).filter(Boolean) as unknown[];
  }
  if (typeof node === "string") {
    return [{ kind: "plain", value: text(ctx, node) }];
  }
  if (node && typeof node === "object") {
    const layer = importTitleLayer(ctx, node as Json);
    return layer ? [layer] : [];
  }
  return [{ kind: "plain", value: ref(ctx, fallbackKey) }];
}

function importContextInput(ci: Json): unknown {
  // Canonical connector shape: { name, type, source: { ref, params?, filter?, sort?, limit? } }.
  if (ci.source?.ref !== undefined) {
    return {
      kind: "sourceRef",
      name: ci.name,
      ref: ci.source.ref,
      ...(ci.source.params ? { params: ci.source.params } : {}),
      ...(ci.source.filter ? { filter: ci.source.filter } : {}),
      ...(ci.source.sort ? { sort: ci.source.sort } : {}),
      ...(ci.source.limit !== undefined ? { limit: ci.source.limit } : {}),
    };
  }
  // Legacy flat shape emitted by older exports: { name, ref }.
  if (ci.ref !== undefined) {
    return { kind: "sourceRef", name: ci.name, ref: ci.ref };
  }
  return {
    kind: "primitive",
    name: ci.name,
    type: ci.type,
    ...(ci.row_of !== undefined ? { rowOf: ci.row_of } : {}),
    ...(ci.default !== undefined ? { default: ci.default } : {}),
  };
}

// menu/v1 lore is `string[]`; domain lore is a single LText (lines joined by `\n`).
function importLore(ctx: I18nCtx, lore: unknown): { key: string } | undefined {
  if (!Array.isArray(lore) || lore.length === 0) return undefined;
  if (lore.length === 1) return text(ctx, String(lore[0]));
  return text(ctx, lore.map(String).join("\n"));
}

function importClickMap(ctx: I18nCtx, click: Json | undefined): Json | undefined {
  if (!click || typeof click !== "object") return undefined;
  const out: Json = {};
  for (const ct of CLICK_TYPES) {
    const handler = click[ct] as Json | string | undefined;
    if (!handler) continue;
    // Canonical collapsed form: the handler IS the DSL string; legacy {steps}.
    const dsl = typeof handler === "string" ? handler : handler.steps;
    out[ct] = { steps: importSteps(ctx, dsl) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function importAppearance(ctx: I18nCtx, a: Json): Json {
  const out: Json = {};
  const ifa = importIfArray(ctx, a.if);
  if (ifa) {
    out.if = ifa.conds;
    if (ifa.joins.length > 0) out.ifJoins = ifa.joins;
  }
  if (a.material) out.material = a.material;
  if (a.head) out.head = a.head;
  if (a.count !== undefined) out.count = a.count;
  if (a.title !== undefined) out.title = text(ctx, a.title);
  const lore = importLore(ctx, a.lore);
  if (lore !== undefined) out.lore = lore;
  const click = importClickMap(ctx, a.click);
  if (click) out.click = click;
  return out;
}

function importElement(ctx: I18nCtx, el: Json): Json {
  return {
    id: el.id,
    positions: el.positions,
    appearances: ((el.appearances as Json[]) ?? []).map((a) => importAppearance(ctx, a)),
    ...(el.iterates ? { iterates: el.iterates } : {}),
    ...(el.tags ? { tags: el.tags } : {}),
  };
}

function importLayer(ctx: I18nCtx, l: Json): Json {
  return {
    id: l.id,
    name: l.name,
    elements: ((l.elements as Json[]) ?? []).map((el) => importElement(ctx, el)),
  };
}

// ─── dialog sub-types ─────────────────────────────────────────────────────────

function importDialogBody(ctx: I18nCtx, b: Json): unknown {
  if (b.type === "text") return { type: "text", text: text(ctx, b.text) };
  if (b.type === "item") return { type: "item", material: b.material, count: b.count };
  return b;
}

function importDialogInput(ctx: I18nCtx, i: Json): unknown {
  const base = { id: i.id, type: i.type, label: text(ctx, i.label) };
  switch (i.type) {
    case "text":
      return { ...base, default: i.default ?? "", maxLength: i.max_length ?? 32 };
    case "bool":
      return { ...base, default: String(i.default) === "true" };
    case "number_range":
      return { ...base, min: i.min ?? 0, max: i.max ?? 100, default: Number(i.default ?? 0) };
    case "single_option": {
      const options = ((i.options as Json[]) ?? []).map((o) => ({
        value: o.value,
        label: text(ctx, o.label),
      }));
      return { ...base, options, default: i.default ?? "" };
    }
    default:
      return base;
  }
}

function importDialogButton(ctx: I18nCtx, b: Json): unknown {
  return {
    id: b.id,
    label: text(ctx, b.label),
    // dialog/v1 button `actions` is a DSL string since Phase 2 (if-branches OK).
    steps: importSteps(ctx, b.actions),
  };
}

// ─── YAML schema types ────────────────────────────────────────────────────────

interface ManifestYaml {
  project_id?: string;
  module?: string;
  default_lang?: string;
  languages?: string[];
  files?: { menus?: string[]; commands?: string[]; dialogs?: string[] };
  editor_layout?: Record<string, unknown>;
  editor_edges?: Record<string, unknown>;
}

interface CommandYaml {
  id?: string;
  name?: string;
  aliases?: string[];
  permission?: string;
  description?: string;
  arguments?: Array<{ name: string; type?: string; required?: boolean; default?: string }>;
  /** Canonical Action DSL string. */
  actions?: unknown;
  /** Legacy spelling of `actions`. */
  steps?: unknown;
}

interface MenuYaml {
  id?: string;
  title?: unknown;
  size?: number;
  rows?: number;
  inventory_type?: string;
  permission?: string;
  notes?: string;
  context_inputs?: Json[];
  layers?: unknown[];
}

interface DialogYaml {
  id?: string;
  title?: string;
  can_close_with_escape?: boolean;
  body?: Json[];
  inputs?: Json[];
  buttons?: Json[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function getFile(files: Record<string, string>, projectId: string, rel: string): string | null {
  return files[`plugins/Artisan/projects/${projectId}/${rel}`] ?? null;
}

/** Strips the canonical `plugins/Artisan/projects/<id>/` prefix, if present. */
function relativeToProject(path: string, projectId: string): string {
  const prefix = `plugins/Artisan/projects/${projectId}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
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
  projectId: string,
): Record<string, { x: number; y: number }> {
  const m = tryParse<ManifestYaml>(getFile(files, projectId, "manifest.yaml")) ?? {};
  return parseEditorLayout(m.editor_layout);
}

/** The owning Add-on module id declared in `manifest.module`, or undefined. */
export function readOwnerModuleFromFiles(
  files: Record<string, string>,
  projectId: string,
): string | undefined {
  const m = tryParse<ManifestYaml>(getFile(files, projectId, "manifest.yaml")) ?? {};
  return typeof m.module === "string" && m.module ? m.module : undefined;
}

// ─── editor edges ─────────────────────────────────────────────────────────────

const ANCHOR_SIDES = new Set(["top", "right", "bottom", "left"]);

interface EdgeAnchorJson {
  side: string;
  t: number;
}

function parseAnchor(raw: unknown): EdgeAnchorJson | null {
  if (!raw || typeof raw !== "object") return null;
  const { side, t } = raw as { side?: unknown; t?: unknown };
  if (typeof side !== "string" || !ANCHOR_SIDES.has(side)) return null;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  return { side, t: Math.min(1, Math.max(0, t)) };
}

function parseEditorEdges(
  raw: unknown,
): Record<string, { from?: EdgeAnchorJson; to?: EdgeAnchorJson }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { from?: EdgeAnchorJson; to?: EdgeAnchorJson }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const from = parseAnchor((v as { from?: unknown }).from);
    const to = parseAnchor((v as { to?: unknown }).to);
    if (!from && !to) continue;
    out[id] = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return out;
}

export function readEditorEdgesFromFiles(
  files: Record<string, string>,
  projectId: string,
): Record<string, { from?: EdgeAnchorJson; to?: EdgeAnchorJson }> {
  const m = tryParse<ManifestYaml>(getFile(files, projectId, "manifest.yaml")) ?? {};
  return parseEditorEdges(m.editor_edges);
}

// ─── lang files ───────────────────────────────────────────────────────────────

/** lang/<lang>.yaml flat maps → key → { lang: value }. */
function readTranslations(
  files: Record<string, string>,
  projectId: string,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [path, content] of Object.entries(files)) {
    const rel = relativeToProject(path, projectId);
    const m = /^lang\/([A-Za-z0-9_-]+)\.ya?ml$/.exec(rel);
    if (!m) continue;
    const lang = m[1]!;
    const parsed = tryParse<Record<string, unknown>>(content);
    if (!parsed || typeof parsed !== "object") continue;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") continue;
      (out[key] ??= {})[lang] = value;
    }
  }
  return out;
}

// ─── public API ───────────────────────────────────────────────────────────────

/** Module dirs must be sane slugs — rejects hostile keys like `__proto__`. */
const MODULE_DIR_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * items/<id>.yml → editor CapturedItem entries. The file is the runtime truth
 * (verbatim `stackYaml`); the display descriptor is derived generically from
 * the serialized stack (nexo custom ref > vanilla id, count, item_name) and an
 * optional root `display:` block in the file overrides the derivation — used
 * by module migrators that know legacy display flags (e.g. enchanted) the
 * stack alone doesn't carry. Byte-order sort keeps the output deterministic.
 */
function readCapturedItems(
  files: Record<string, string>,
  projectId: string,
): { id: string; name: string; stackYaml: string; display: Record<string, unknown> }[] {
  const out: { id: string; name: string; stackYaml: string; display: Record<string, unknown> }[] = [];
  for (const [path, content] of Object.entries(files)) {
    const rel = relativeToProject(path, projectId);
    if (!rel.startsWith("items/") || rel.indexOf("/", "items/".length) !== -1) continue;
    const id = rel.slice("items/".length).replace(/\.ya?ml$/, "");
    if (!id) continue;
    const root = tryParse<Record<string, unknown>>(content);
    if (!root || typeof root !== "object") continue;
    const stack = (root.item ?? root) as Record<string, unknown>; // `==:`-root tolerated
    if (!stack || typeof stack !== "object") continue;
    const display: Record<string, unknown> = {};
    const vanillaId = typeof stack.id === "string" ? stack.id : "";
    if (vanillaId) display.material = vanillaId.replace(/^minecraft:/, "").toUpperCase();
    const components = (stack.components ?? {}) as Record<string, unknown>;
    const nexo = /"nexo:id"\s*:\s*"([^"]+)"/.exec(String(components["minecraft:custom_data"] ?? ""));
    if (nexo) display.material = `nexo:${nexo[1]}`;
    const count = typeof stack.count === "number" ? stack.count : 1;
    if (count > 1) display.count = count;
    const nameMatch = /text\s*:\s*"([^"]*)"/.exec(String(components["minecraft:item_name"] ?? ""));
    if (nameMatch?.[1]) display.name = nameMatch[1];
    if (root.display && typeof root.display === "object") Object.assign(display, root.display);
    out.push({ id, name: typeof display.name === "string" ? display.name : id, stackYaml: content, display });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function importProjectFromFiles(projectId: string, files: Record<string, string>): Record<string, unknown> {
  const manifest = tryParse<ManifestYaml>(getFile(files, projectId, "manifest.yaml")) ?? {};
  const defaultLang = manifest.default_lang ?? "en";
  const commandIds  = manifest.files?.commands ?? [];
  const dialogIds   = manifest.files?.dialogs  ?? [];
  const menuIds     = manifest.files?.menus    ?? [];
  const now         = new Date().toISOString();

  const translations = readTranslations(files, projectId);
  const ctx: I18nCtx = { defaultLang, translations, i18nKeys: {}, unsupported: [] };
  // Seed every disk translation so keys referenced via `{i18n:...}` (and any
  // extra keys the admin keeps in lang files) survive the import.
  for (const [key, langs] of Object.entries(translations)) {
    ctx.i18nKeys[key] = { ...langs };
  }

  const commands = commandIds.map((cmdId) => {
    const y = tryParse<CommandYaml>(getFile(files, projectId, `commands/${cmdId}.yaml`)) ?? {};
    return {
      id: y.id ?? cmdId,
      projectId,
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
      // Canonical field is `actions`; `steps` is the legacy spelling.
      steps: importSteps(ctx, y.actions ?? y.steps),
    };
  });

  const dialogs = dialogIds.map((dlgId) => {
    const y = tryParse<DialogYaml>(getFile(files, projectId, `dialogs/${dlgId}.yaml`)) ?? {};
    return {
      id: y.id ?? dlgId,
      projectId,
      title: typeof y.title === "string" ? text(ctx, y.title) : ref(ctx, `dialogs.${dlgId}.title`),
      canCloseWithEscape: y.can_close_with_escape ?? true,
      body: (y.body ?? []).map((b) => importDialogBody(ctx, b)),
      inputs: (y.inputs ?? []).map((i) => importDialogInput(ctx, i)),
      buttons: (y.buttons ?? []).map((b) => importDialogButton(ctx, b)),
    };
  });

  const menus = menuIds.map((menuId) => {
    const y = tryParse<MenuYaml>(getFile(files, projectId, `menus/${menuId}.yaml`)) ?? {};
    const inventoryType =
      y.inventory_type === "hopper" || y.inventory_type === "dropper" ? y.inventory_type : "chest";
    const rows =
      inventoryType !== "chest"
        ? inventoryType === "dropper"
          ? 3
          : 1
        : (y.rows ?? (y.size ? Math.max(1, Math.min(6, Math.round(y.size / 9))) : 3));
    const contextInputs = Array.isArray(y.context_inputs)
      ? y.context_inputs.map(importContextInput)
      : [];
    return {
      id: y.id ?? menuId,
      projectId,
      title: importTitle(ctx, y.title, `menus.${menuId}.title`),
      rows: rows as 1 | 2 | 3 | 4 | 5 | 6,
      ...(inventoryType !== "chest" ? { inventoryType } : {}),
      layers: Array.isArray(y.layers)
        ? y.layers.map((l) => importLayer(ctx, l as Json))
        : [{ id: "layer_default", name: "Default", elements: [] }],
      ...(y.permission ? { permission: y.permission } : {}),
      ...(typeof y.notes === "string" && y.notes ? { notes: y.notes } : {}),
      ...(contextInputs.length > 0 ? { contextInputs } : {}),
    };
  });

  const project: Record<string, unknown> = {
    id: projectId,
    name: projectId,
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
    i18nKeys: ctx.i18nKeys,
    defaultLang,
    canvasLayout: parseEditorLayout(manifest.editor_layout),
    canvasEdges: parseEditorEdges(manifest.editor_edges),
  };
  // Add-on-owned project: manifest `module:` id → carried on the editor state so
  // the sidebar groups it under "Installed modules" (ADR addon-owned-project-roots).
  if (typeof manifest.module === "string" && manifest.module) {
    project.ownerModule = manifest.module;
  }

  const capturedItems = readCapturedItems(files, projectId);
  if (capturedItems.length > 0) project.capturedItems = capturedItems;

  const CORE_PREFIXES = ["menus/", "commands/", "dialogs/", "lang/", "items/"];
  const CORE_FILES = new Set(["manifest.yaml", "meta.yaml"]);
  // Null-prototype accumulator: hostile dir names ("__proto__", "constructor")
  // can't clobber Object.prototype; the regex guard skips them anyway.
  const moduleData: Record<string, { __files: Record<string, string> }> = Object.create(null);
  for (const [path, content] of Object.entries(files)) {
    const rel = relativeToProject(path, projectId);
    if (CORE_FILES.has(rel) || CORE_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const slash = rel.indexOf("/");
    if (slash <= 0) continue; // top-level unknown files: ignored
    const dir = rel.slice(0, slash);
    if (!MODULE_DIR_RE.test(dir) || dir in Object.prototype) continue;
    (moduleData[dir] ??= { __files: {} }).__files[rel.slice(slash + 1)] = content;
  }
  if (Object.keys(moduleData).length > 0) project.moduleData = { ...moduleData };

  if (ctx.unsupported.length > 0) {
    console.warn(`[projectImport] ${projectId}: dropped unsupported constructs: ${ctx.unsupported.join(", ")}`);
  }

  return project;
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
    // This catches projects imported before full YAML parsing was implemented.
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
