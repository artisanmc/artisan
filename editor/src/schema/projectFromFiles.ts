// Full-project files → domain importer — the exact inverse of
// `features/export/transform.ts` (ADR files-first-source-of-truth: the file
// tree is the canonical, lossless Project representation; the editor parses it
// on open and serializes back on save). Locked by projectFromFiles.test.ts
// (fixed-point round-trip) — any new file form added to transform() MUST gain
// its inverse here in the same commit.
import type {
  CapturedItem,
  DataModel,
  DataModelId,
  DataSource,
  DataSourceId,
  EdgeAnchor,
  I18nKey,
  ItemTemplate,
  ItemTemplateId,
  LText,
  ModelField,
  ModelFieldType,
  Project,
  ProjectId,
} from "@/domain/types";
import { visitDataSourceLTexts } from "@/domain/i18nSites";
import { newI18nKey } from "@/lib/i18n";
import { parse as parseYaml } from "yaml";
import { commandV1ToDomain } from "./commandV1ToDomain";
import { dialogV1ToDomain } from "./dialogV1ToDomain";
import { makeAppearanceConverter, menuV1ToDomain } from "./menuV1ToDomain";

// biome-ignore lint/suspicious/noExplicitAny: untyped wire objects — fields read by snake name
type Json = Record<string, any>;

interface ManifestYaml {
  project_id?: string;
  module?: string;
  default_lang?: string;
  languages?: string[];
  files?: { menus?: string[]; commands?: string[]; dialogs?: string[] };
  /** Legacy home of the board state (pre `.artisan/editor.yaml`). */
  editor_layout?: Record<string, unknown>;
  editor_edges?: Record<string, unknown>;
}

/** `.artisan/editor.yaml` — hash-excluded editor metadata. */
interface EditorStateYaml {
  layout?: Record<string, unknown>;
  edges?: Record<string, unknown>;
  /** Captured item label + display descriptor, keyed by item id. */
  items?: Record<string, { name?: string; display?: Record<string, unknown> }>;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function baseOf(projectId: string): string {
  return `plugins/Artisan/projects/${projectId}/`;
}

function getFile(files: Record<string, string>, projectId: string, rel: string): string | null {
  return files[`${baseOf(projectId)}${rel}`] ?? null;
}

/** Strips the canonical `plugins/Artisan/projects/<id>/` prefix, if present. */
function relativeToProject(path: string, projectId: string): string {
  const prefix = baseOf(projectId);
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function tryParse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return parseYaml(text) as T;
  } catch {
    return null;
  }
}

/** Leading hand-written comment block of a data file (ADR bare-data-files ⑦):
 *  comment lines before the content, minus the generated hint block (from its
 *  `# ──` marker line onward — that block is regenerated at every export). */
function leadingHandComment(text: string): string {
  const head: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) head.push(line);
    else break;
  }
  const gen = head.findIndex((l) => l.startsWith("# ──"));
  return (gen === -1 ? head : head.slice(0, gen)).join("\n");
}

/** Scan `<dir>/<id>.yaml` entries, sorted by path (deterministic). */
function scanDir(
  files: Record<string, string>,
  projectId: string,
  dir: string,
): { id: string; parsed: Json }[] {
  const prefix = `${baseOf(projectId)}${dir}/`;
  return Object.keys(files)
    .filter((k) => k.startsWith(prefix) && k.endsWith(".yaml"))
    .sort()
    .flatMap((k) => {
      const parsed = tryParse<Json>(files[k]!);
      if (!parsed) return [];
      const id = (parsed.id as string) ?? k.slice(prefix.length, -".yaml".length);
      return [{ id, parsed }];
    });
}

// ─── board state (layout / edges) ────────────────────────────────────────────

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

const ANCHOR_SIDES = new Set(["top", "right", "bottom", "left"]);

function parseAnchor(raw: unknown): EdgeAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const { side, t } = raw as { side?: unknown; t?: unknown };
  if (typeof side !== "string" || !ANCHOR_SIDES.has(side)) return null;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  return { side: side as EdgeAnchor["side"], t: Math.min(1, Math.max(0, t)) };
}

function parseEditorEdges(raw: unknown): Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const from = parseAnchor((v as { from?: unknown }).from);
    const to = parseAnchor((v as { to?: unknown }).to);
    if (!from && !to) continue;
    out[id] = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return out;
}

// ─── lang files ──────────────────────────────────────────────────────────────

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

// ─── captured items ──────────────────────────────────────────────────────────

/**
 * items/<id>.yml → CapturedItem. The file is the runtime truth (verbatim
 * `stackYaml`); name + display come from `.artisan/editor.yaml` `items:` when
 * present (the lossless editor channel — enchanted/headTexture aren't
 * derivable from the stack). Fallback for hand-added files: a generic
 * derivation from vanilla components, overridable by a root `display:` block
 * (used by module migrators). Byte-order sort keeps output deterministic.
 */
function readCapturedItems(
  files: Record<string, string>,
  projectId: string,
  itemsMeta: NonNullable<EditorStateYaml["items"]>,
): CapturedItem[] {
  const out: CapturedItem[] = [];
  for (const [path, content] of Object.entries(files)) {
    const rel = relativeToProject(path, projectId);
    if (!rel.startsWith("items/") || rel.indexOf("/", "items/".length) !== -1) continue;
    const id = rel.slice("items/".length).replace(/\.ya?ml$/, "");
    if (!id) continue;
    const root = tryParse<Record<string, unknown>>(content);
    if (!root || typeof root !== "object") continue;
    const stack = (root.item ?? root) as Record<string, unknown>; // `==:`-root tolerated
    if (!stack || typeof stack !== "object") continue;
    const display: CapturedItem["display"] = {};
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
    const meta = itemsMeta[id];
    out.push({
      id: id as CapturedItem["id"],
      name: meta?.name ?? (typeof display.name === "string" ? display.name : id),
      stackYaml: content,
      display: (meta?.display as CapturedItem["display"]) ?? display,
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ─── data sources (data/v1 → domain, typed by Data models) ───────────────────

/** data/v1 flattened field → ModelFieldType (used when no model back-ref exists). */
function fieldTypeOfWire(f: Json): ModelFieldType {
  switch (f.kind) {
    case "list":
      return { kind: "list", of: fieldTypeOfWire(f.of ?? { kind: "string" }) };
    case "object":
      return { kind: "object", fields: ((f.fields as Json[]) ?? []).map(fieldOfWire) };
    case "map":
      return { kind: "map", of: fieldTypeOfWire(f.of ?? { kind: "string" }) };
    case "enum":
      return { kind: "enum", values: Array.isArray(f.values) ? f.values.map(String) : [] };
    case "union":
      return {
        kind: "union",
        tag: typeof f.tag === "string" ? f.tag : "type",
        variants: ((f.variants as Json[]) ?? []).map((v) => ({
          name: String(v.name ?? ""),
          fields: ((v.fields as Json[]) ?? []).map(fieldOfWire),
        })),
      };
    case "number":
    case "integer":
    case "boolean":
    case "ltext":
    case "item":
    case "actions":
    case "conditions":
      return { kind: f.kind };
    default:
      return { kind: "string" };
  }
}

function fieldOfWire(f: Json): ModelField {
  return { name: f.name, type: fieldTypeOfWire(f) };
}

/**
 * Inverse of serializeDataValue: re-wrap wire values into domain values guided
 * by the declared field type — ltext key strings become LText nodes (pulling
 * their translations back into i18nKeys via `ref`).
 */
function importDataValue(
  value: unknown,
  type: ModelFieldType,
  models: DataModel[],
  visited: Set<DataModelId>,
  ref: (key: string) => LText,
): unknown {
  switch (type.kind) {
    case "ltext":
      return ref(typeof value === "string" ? value : "");
    case "list":
      return Array.isArray(value)
        ? value.map((el) => importDataValue(el, type.of, models, visited, ref))
        : [];
    case "object": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      // Untyped object (bare file, no schema anywhere — ADR bare-data-files):
      // preserve the value VERBATIM instead of projecting onto zero fields
      // (which would silently drop everything).
      if (type.fields.length === 0) return obj;
      const out: Record<string, unknown> = {};
      for (const f of type.fields) out[f.name] = importDataValue(obj[f.name], f.type, models, visited, ref);
      return out;
    }
    case "model": {
      const model = visited.has(type.ref) ? undefined : models.find((m) => m.id === type.ref);
      if (!model) return {};
      const next = new Set(visited).add(type.ref);
      return importDataValue(value, { kind: "object", fields: model.fields }, models, next, ref);
    }
    case "map": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = importDataValue(v, type.of, models, visited, ref);
      return out;
    }
    case "enum":
      return value;
    case "union": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const variant = type.variants.find((v) => v.name === obj[type.tag]);
      if (!variant) return { [type.tag]: obj[type.tag] };
      const out: Record<string, unknown> = { [type.tag]: obj[type.tag] };
      for (const f of variant.fields) out[f.name] = importDataValue(obj[f.name], f.type, models, visited, ref);
      return out;
    }
    default:
      return value;
  }
}

// ─── public API ──────────────────────────────────────────────────────────────

/** Module dirs must be sane slugs — rejects hostile keys like `__proto__`. */
const MODULE_DIR_RE = /^[a-z][a-z0-9_-]*$/;

/** Dirs and files owned by the core importer — everything else under a slug
 *  dir belongs to a module (`moduleData[ns].__files`). */
const CORE_PREFIXES = [
  "menus/",
  "commands/",
  "dialogs/",
  "lang/",
  "items/",
  "templates/",
  "models/",
  "data/",
];
const CORE_FILES = new Set(["manifest.yaml", "meta.yaml"]);

export interface ProjectFromFilesMeta {
  name?: string;
  /** Forme URL (DB-owned, jamais dans les fichiers). */
  slug?: string;
  description?: string;
  source?: Project["source"];
  serverKeyId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Parse a Project's canonical file tree into the domain shape. `meta` carries
 * the DB-owned fields (name, timestamps) that never live in files.
 */
export function projectFromFiles(
  projectId: ProjectId,
  files: Record<string, string>,
  meta: ProjectFromFilesMeta = {},
): Project {
  const manifest = tryParse<ManifestYaml>(getFile(files, projectId, "manifest.yaml")) ?? {};
  const defaultLang = manifest.default_lang ?? "en";
  const now = new Date().toISOString();

  const translations = readTranslations(files, projectId);
  const i18nKeys: Record<string, Record<string, string>> = {};
  // Seed every disk translation so keys referenced via `{i18n:...}` (and any
  // extra keys the admin keeps in lang files) survive the import.
  for (const [key, langs] of Object.entries(translations)) i18nKeys[key] = { ...langs };
  const unsupported: string[] = [];

  const convertOpts = { projectId, lang: defaultLang, translations };

  const menus = (manifest.files?.menus ?? []).flatMap((menuId) => {
    const y = tryParse<Json>(getFile(files, projectId, `menus/${menuId}.yaml`));
    if (!y) return [];
    const r = menuV1ToDomain({ id: menuId, ...y }, convertOpts);
    Object.assign(i18nKeys, r.i18nKeys);
    unsupported.push(...r.unsupported);
    return [r.menu];
  });

  const commands = (manifest.files?.commands ?? []).flatMap((cmdId) => {
    const y = tryParse<Json>(getFile(files, projectId, `commands/${cmdId}.yaml`));
    if (!y) return [];
    const r = commandV1ToDomain({ id: cmdId, ...y }, convertOpts);
    Object.assign(i18nKeys, r.i18nKeys);
    unsupported.push(...r.unsupported);
    return [r.command];
  });

  const dialogs = (manifest.files?.dialogs ?? []).flatMap((dlgId) => {
    const y = tryParse<Json>(getFile(files, projectId, `dialogs/${dlgId}.yaml`));
    if (!y) return [];
    const r = dialogV1ToDomain({ id: dlgId, ...y }, convertOpts);
    Object.assign(i18nKeys, r.i18nKeys);
    unsupported.push(...r.unsupported);
    return [r.dialog];
  });

  // Shared i18n bridge for the file kinds without a per-document converter
  // (templates, data sources).
  function ref(key: string): LText {
    const tr = translations[key];
    if (tr) i18nKeys[key] = { ...tr };
    return { key: key as I18nKey };
  }
  function text(raw: string | undefined): LText {
    const m = typeof raw === "string" ? /^\{i18n:(.+)\}$/.exec(raw) : null;
    if (m) return ref(m[1]!);
    const key = newI18nKey();
    i18nKeys[key] = { [defaultLang]: raw ?? "" };
    return { key };
  }
  // Tolerant ltext import for data sources (ADR bare-data-files ④): a value
  // matching a known translation key resolves as that key; anything else is
  // the DEFAULT LANGUAGE'S literal text (minted key).
  function ltData(raw: string): LText {
    return translations[raw] ? ref(raw) : text(raw);
  }
  const { appearance } = makeAppearanceConverter({
    text,
    ref,
    pushUnsupported: (s) => unsupported.push(s),
  });

  // Item templates: templates/<id>.yaml (template/v1). Scanned from file keys
  // (not a manifest list) so a hand-added file still imports.
  const itemTemplates: ItemTemplate[] = scanDir(files, projectId, "templates").map(({ id, parsed: y }) => ({
    id: id as ItemTemplateId,
    projectId,
    name: (y.name as string) ?? id,
    sourceRef: y.source ?? "",
    alias: y.alias ?? "",
    ...(y.key_field ? { keyField: y.key_field } : {}),
    ...(y.group_by ? { groupBy: y.group_by } : {}),
    appearances: ((y.appearances as Json[]) ?? []).map(appearance),
  }));

  // Data models: models/<id>.yaml (model/v1), fields verbatim — the lossless
  // typing store. A models/ file that is ONLY a `model:` ref (ADR
  // bare-data-files ⑤: one-line link from a bare source to a declared model)
  // never becomes a Data model itself — it's recorded as a source → model ref.
  // Ref-only files (source → model link) and, for docs emitted at a SOURCE's
  // filename (owned models), the filename → doc-id/name mapping — both feed
  // the bare-source schema resolution below.
  const modelRefs: Record<string, { model: string; name?: string; version?: number }> = {};
  const modelFileDoc: Record<string, { docId: string; name?: string }> = {};
  const dataModels: DataModel[] = scanDir(files, projectId, "models").flatMap(({ id, parsed: y }) => {
    const fields = ((y.fields as ModelField[]) ?? []) as ModelField[];
    if (fields.length === 0 && typeof y.model === "string") {
      modelRefs[id] = {
        model: y.model,
        ...(typeof y.name === "string" ? { name: y.name } : {}),
        ...(typeof y.model_version === "number" ? { version: y.model_version } : {}),
      };
      return [];
    }
    // Identity lives INSIDE the doc when present (owned model emitted at the
    // source's filename — ADR bare-data-files ⑤); the filename is the lookup.
    const docId = (y.id as string) ?? id;
    modelFileDoc[id] = { docId, ...(typeof y.name === "string" ? { name: y.name } : {}) };
    return [{
      id: docId as DataModelId,
      name: (y.name as string) ?? docId,
      keyField: (y.key_field as string) ?? "id",
      ...(y.master_detail === true ? { masterDetail: true } : {}),
      fields,
    }];
  });

  // Project sources: data/<id>.yaml (data/v1) or, per-row granularity, a
  // data/<id>/ directory with _source.yaml + one file per row (ADR
  // composable-data-models §2). Table sources are re-typed by their Data model
  // via the `model:` back-ref; a hand-written file without one gets a model
  // synthesized from its flattened fields (canonicalized on the next export,
  // same spirit as literal-text key minting).
  const dataPrefix = `${baseOf(projectId)}data/`;
  // A bare source's model resolves beside the data (ADR bare-data-files ①):
  // models/<sourceId>.yaml own fields, or its one-line `model:` ref (kept
  // namespaced for post-load declared-model injection).
  const besideOf = (
    sourceId: string,
  ): { model?: string; name?: string; version?: number } => {
    const r = modelRefs[sourceId];
    if (r) return r;
    const d = modelFileDoc[sourceId];
    if (d) return { model: d.docId, name: d.name };
    return {};
  };
  // Top-level files only — nested paths belong to per-row source dirs below.
  const topLevelDataSources = Object.keys(files)
    .filter(
      (k) =>
        k.startsWith(dataPrefix) &&
        k.endsWith(".yaml") &&
        !k.slice(dataPrefix.length).includes("/"),
    )
    .sort()
    .flatMap((k) => {
      const fileId = k.slice(dataPrefix.length, -".yaml".length);
      const raw = tryParse<unknown>(files[k]!);
      if (!raw) return [];
      // Bare list = table, bare mapping (no data/* header) = object source
      // (ADR bare-data-files ②/③) — values only, schema resolved beside.
      const header = leadingHandComment(files[k]!);
      if (Array.isArray(raw)) {
        const b = besideOf(fileId);
        return [{ id: fileId, parsed: {
          shape: "table", model: b.model, name: b.name,
          ...(b.version !== undefined ? { model_version: b.version } : {}),
          ...(header ? { header_comment: header } : {}),
          rows: raw,
        } as Json }];
      }
      const parsed = raw as Json;
      if (typeof parsed !== "object") return [];
      if (!String(parsed.schema ?? "").startsWith("data/")) {
        const b = besideOf(fileId);
        return [{ id: fileId, parsed: {
          shape: "config", model: b.model, name: b.name,
          ...(header ? { header_comment: header } : {}),
          value: parsed,
        } as Json }];
      }
      const id = (parsed.id as string) ?? fileId;
      return [{ id, parsed }];
    });
  // Per-row dirs: any data/<dir>/ holding row files — `_source.yaml` is
  // OPTIONAL (absent → all files, byte-sorted; present → legacy full meta or
  // minimal `model:` + `order:`).
  const perRowSourceDirs = [...new Set(
    Object.keys(files)
      .filter((k) => k.startsWith(dataPrefix) && k.endsWith(".yaml") && k.slice(dataPrefix.length).includes("/"))
      .map((k) => k.slice(dataPrefix.length).split("/", 1)[0]!),
  )].sort();
  const perRowParsed = perRowSourceDirs.flatMap((dir) => {
    const metaRawText = files[`${dataPrefix}${dir}/_source.yaml`];
    const rawMeta = tryParse<Json>(metaRawText ?? null) ?? ({} as Json);
    const metaHeader = metaRawText ? leadingHandComment(metaRawText) : "";
    // Order-only (or absent) meta: resolve the model beside the data.
    const b = rawMeta.model == null && rawMeta.fields == null ? besideOf(dir) : {};
    const meta = {
      ...rawMeta,
      ...(rawMeta.model == null && b.model !== undefined ? { model: b.model } : {}),
      ...(rawMeta.name == null && b.name !== undefined ? { name: b.name } : {}),
      ...(metaHeader ? { header_comment: metaHeader } : {}),
    } as Json;
    const rowPrefix = `${dataPrefix}${dir}/`;
    const onDisk = Object.keys(files)
      .filter((k) => k.startsWith(rowPrefix) && k.endsWith(".yaml") && !k.endsWith("/_source.yaml"))
      .map((k) => k.slice(rowPrefix.length, -".yaml".length))
      .filter((n) => !n.includes("/"));
    const order: string[] = Array.isArray(meta.order) ? meta.order.map(String) : [];
    // Declared order first, then hand-added files not in the order (byte-sorted).
    const names = [...order.filter((n) => onDisk.includes(n)), ...onDisk.filter((n) => !order.includes(n)).sort()];
    const rows = names.flatMap((n) => {
      const row = tryParse<Json>(files[`${rowPrefix}${n}.yaml`] ?? null);
      return row ? [row] : [];
    });
    return [{ id: (meta.id as string) ?? dir, parsed: { ...meta, rows, granularity: "row" } as Json }];
  });
  const dataSources: DataSource[] = [...topLevelDataSources, ...perRowParsed]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, parsed: y }) => {
    const nameFromModel = dataModels.find((m) => String(m.id) === y.model)?.name;
    const name = (y.name as string) ?? nameFromModel ?? id;
    if (y.shape === "config") {
      // Fields: inline (legacy) or the beside-the-data model's (bare form).
      const fields = y.fields != null
        ? ((y.fields as Json[]) ?? []).map(fieldOfWire)
        : (dataModels.find((m) => m.id === y.model)?.fields ?? []);
      const value = importDataValue(
        y.value ?? {},
        { kind: "object", fields },
        dataModels,
        new Set(),
        ltData,
      ) as Record<string, unknown>;
      return {
        id: id as DataSourceId,
        name,
        shape: "config",
        fields,
        // Namespaced ref the project files can't resolve: the model is
        // module-declared and arrives via Presence — keep the ref so
        // `injectDeclaredModels` can type this source after the load.
        ...(typeof y.model === "string" && fields.length === 0
          ? { modelId: y.model as DataModelId }
          : {}),
        value,
        ...(typeof y.header_comment === "string" && y.header_comment !== ""
          ? { headerComment: y.header_comment }
          : {}),
      };
    }
    // Module-declared model ref (namespaced): the shape's truth arrives via
    // Presence, never from project files — keep the ref as-is and type the
    // rows from the file's own flattened fields (self-contained). The loader
    // injects the declared model and runs pending migrations afterwards.
    if (typeof y.model === "string" && y.model.includes(":") && !dataModels.some((m) => m.id === y.model)) {
      const rowType: ModelFieldType = {
        kind: "object",
        fields: ((y.fields as Json[]) ?? []).map(fieldOfWire),
      };
      const rows = ((y.rows as Json[]) ?? []).map(
        (r) => importDataValue(r, rowType, dataModels, new Set(), ltData) as Record<string, unknown>,
      );
      return {
        id: id as DataSourceId,
        name,
        shape: "table",
        modelId: y.model as DataModelId,
        ...(y.granularity === "row" ? { granularity: "row" as const } : {}),
        ...(typeof y.model_version === "number" ? { modelVersion: y.model_version } : {}),
        rows,
        ...(typeof y.header_comment === "string" && y.header_comment !== ""
          ? { headerComment: y.header_comment }
          : {}),
      };
    }
    let model = dataModels.find((m) => m.id === y.model);
    if (!model) {
      model = {
        id: `mdl_${id}` as DataModelId,
        name,
        keyField: (y.key_field as string) ?? "id",
        fields: ((y.fields as Json[]) ?? []).map(fieldOfWire),
      };
      dataModels.push(model);
    }
    const modelId = model.id;
    const rowType: ModelFieldType = { kind: "object", fields: model.fields };
    const rows = ((y.rows as Json[]) ?? []).map(
      (r) =>
        importDataValue(r, rowType, dataModels, new Set([modelId]), ltData) as Record<string, unknown>,
    );
    return {
      id: id as DataSourceId,
      name,
      shape: "table",
      modelId,
      ...(y.granularity === "row" ? { granularity: "row" as const } : {}),
      ...(typeof y.model_version === "number" ? { modelVersion: y.model_version } : {}),
      rows,
      ...(typeof y.header_comment === "string" && y.header_comment !== ""
        ? { headerComment: y.header_comment }
        : {}),
    };
  });

  // Reconnect data-source ltext nodes to their canonical key-site address
  // (ADR bare-data-files ④): a bare file inlines the default language's
  // literal (imported as a freshly-minted key); other languages live in lang/
  // under the canonical address. Rekey the node to that address and merge —
  // the literal wins for the default language. Sources typed by a declared
  // model reconnect after injection (loader side) — here their model is
  // absent and the visitor yields nothing.
  {
    const projLike = { dataModels, dataSources, i18nKeys, defaultLang } as unknown as Project;
    for (const ds of dataSources) {
      for (const site of visitDataSourceLTexts(projLike, ds)) {
        const a = site.key as string;
        const k = site.lText.key as string;
        if (k === a) continue;
        i18nKeys[a as I18nKey] = { ...(translations[a] ?? {}), ...(i18nKeys[k as I18nKey] ?? {}) };
        if (!translations[k]) delete i18nKeys[k as I18nKey];
        site.lText.key = a as I18nKey;
      }
    }
  }

  const editorState = tryParse<EditorStateYaml>(getFile(files, projectId, ".artisan/editor.yaml")) ?? {
    layout: manifest.editor_layout,
    edges: manifest.editor_edges,
  };

  const capturedItems = readCapturedItems(files, projectId, editorState.items ?? {});

  // Unclaimed slug dirs → moduleData[ns].__files (modules normalize on first
  // read; unregistered namespaces re-export verbatim). Null-prototype
  // accumulator: hostile dir names can't clobber Object.prototype.
  const moduleData: Record<string, { __files: Record<string, string> }> = Object.create(null);
  for (const [path, content] of Object.entries(files)) {
    const rel = relativeToProject(path, projectId);
    if (CORE_FILES.has(rel) || CORE_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const slash = rel.indexOf("/");
    if (slash <= 0) continue; // top-level unknown files (and .artisan/*): ignored
    const dir = rel.slice(0, slash);
    if (!MODULE_DIR_RE.test(dir) || dir in Object.prototype) continue;
    (moduleData[dir] ??= { __files: {} }).__files[rel.slice(slash + 1)] = content;
  }

  const project: Project = {
    id: projectId,
    name: meta.name ?? projectId,
    ...(meta.slug ? { slug: meta.slug } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    // `source` is cosmetic (badge) and DB/file-less — default to the common case.
    source: meta.source ?? "user_created",
    ...(meta.serverKeyId ? { serverKeyId: meta.serverKeyId } : {}),
    createdAt: meta.createdAt ?? now,
    updatedAt: meta.updatedAt ?? now,
    menus,
    commands,
    templates: [],
    ...(itemTemplates.length > 0 ? { itemTemplates } : {}),
    ...(capturedItems.length > 0 ? { capturedItems } : {}),
    assets: [],
    dataSources,
    ...(dataModels.length > 0 ? { dataModels } : {}),
    i18nKeys: i18nKeys as Project["i18nKeys"],
    defaultLang,
    dialogs,
    canvasLayout: parseEditorLayout(editorState.layout),
    ...(Object.keys(parseEditorEdges(editorState.edges)).length > 0
      ? { canvasEdges: parseEditorEdges(editorState.edges) }
      : {}),
    ...(Object.keys(moduleData).length > 0 ? { moduleData: { ...moduleData } } : {}),
    ...(typeof manifest.module === "string" && manifest.module
      ? { ownerModule: manifest.module }
      : {}),
  };

  if (unsupported.length > 0) {
    console.warn(`[projectFromFiles] ${projectId}: dropped unsupported constructs: ${unsupported.join(", ")}`);
  }

  return project;
}
