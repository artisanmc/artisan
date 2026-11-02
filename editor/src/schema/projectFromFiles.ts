import { normalizeBaseLore } from "@/domain/baseLore";
import { parseCapturedStack } from "@/domain/capturedStack";
import { listDocumentKinds } from "@/domain/documentKinds";
import {
  type LayoutEntry,
  ORIGINALS_DIR,
  ORIGINALS_INDEX,
  VARIANTS_FILE,
  classifyDocumentLayout,
  isOriginalPath,
  sameFile,
  variantsPath,
} from "@/domain/documentLayout";
import {
  type DocKey,
  allDocuments,
  docKey,
  emptyDocuments,
  isDocKey,
  menusOf,
  mutableDocuments,
} from "@/domain/documents";
import { normalizeFolderMeta } from "@/domain/folders";
import {
  adoptAddressedTranslations,
  visitDataSourceLTexts,
  visitElementLTexts,
} from "@/domain/i18nSites";
import { itemTextFields } from "@/domain/itemTextFields";
// Full-project files → domain importer — the exact inverse of
// `projectToFiles.ts` (ADR files-first-source-of-truth: the file
// tree is the canonical, lossless Project representation; the editor parses it
// on open and serializes back on save). Locked by projectFromFiles.test.ts
// (fixed-point round-trip) — any new file form added to projectToFiles() MUST gain
// its inverse here in the same commit.
import type {
  Appearance,
  CapturedItem,
  DataModel,
  DataModelId,
  DataSource,
  DataSourceId,
  Document,
  EdgeAnchor,
  I18nKey,
  LText,
  Menu,
  ModelField,
  ModelFieldType,
  Project,
  ProjectId,
  ProjectOriginals,
  ProjectVariants,
} from "@/domain/types";
import { VARIANT_KINDS, rulesFromYaml } from "@/domain/variants";
import { newI18nKey } from "@/lib/i18n";
import { flattenLangTree } from "@/lib/langTree";
import { MODULE_FILE_NAMES, YAML_EXT, isYamlPath, yamlFilesUnder, yamlStem } from "@/lib/yamlFiles";
import { parse as parseYaml } from "yaml";
import { mergeCommandVariant } from "./commandVariant";
import { documentCodec } from "./documentCodecs";
import { makeAppearanceConverter } from "./menuV1ToDomain";

// biome-ignore lint/suspicious/noExplicitAny: untyped wire objects — fields read by snake name
type Json = Record<string, any>;

interface ManifestYaml {
  project_id?: string;
  module?: string;
  default_lang?: string;
  languages?: string[];
  lore_max_width?: number;
  escape_goes_back?: boolean;
  /** Legacy, keyed by document folder (`menus`, `commands`, `dialogs`). */
  files?: Record<string, string[] | undefined>;
  /** What the owner does with the module's originals (design `originaux-modules`). */
  originals?: { exclude?: unknown };
  /** Legacy home of the board state (pre `.artisan/editor.yaml`). */
  editor_layout?: Record<string, unknown>;
  editor_edges?: Record<string, unknown>;
}

/** `.artisan/editor.yaml` — hash-excluded editor metadata. */
interface EditorStateYaml {
  /** Themed folders' colors, positions and empty folders, keyed by path. */
  folders?: unknown;
  layout?: Record<string, unknown>;
  edges?: Record<string, unknown>;
  /** Captured item label + display descriptor, keyed by item id. */
  items?: Record<string, { name?: string; display?: Record<string, unknown> }>;
}

// Helpers

function baseOf(projectId: string): string {
  return `plugins/Artisan/projects/${projectId}/`;
}

function getFile(files: Record<string, string>, projectId: string, rel: string): string | null {
  return files[`${baseOf(projectId)}${rel}`] ?? null;
}

/** Every file path of the project, relative to its folder. */
function projectPaths(files: Record<string, string>, projectId: string): string[] {
  const prefix = baseOf(projectId);
  return Object.keys(files)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

function kindDirs(): Set<string> {
  return new Set(listDocumentKinds().map((def) => def.dir));
}

/**
 * Rewrites the `plugins/Artisan/projects/<anything>/` key prefix to
 * [projectId]. A project's tree only contains its own paths, so rewriting
 * without looking at WHICH id was there is safe — and makes reading
 * insensitive to a disk id that differs from the internal id.
 */
function normalizeProjectPrefix(
  files: Record<string, string>,
  projectId: string,
): Record<string, string> {
  const want = baseOf(projectId);
  const re = /^plugins\/Artisan\/projects\/[^/]+\//;
  let changed = false;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    const nk = re.test(k) ? k.replace(re, want) : k;
    if (nk !== k) changed = true;
    out[nk] = v;
  }
  return changed ? out : files;
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

/** Scan `<dir>/<name>.yml` (or `.yaml`) entries, sorted by name (deterministic). `id` is
 *  the doc's own `id:` when present, else the file name; `file` is always the
 *  file name. */
function scanDir(
  files: Record<string, string>,
  projectId: string,
  dir: string,
): { id: string; file: string; parsed: Json }[] {
  const prefix = `${baseOf(projectId)}${dir}/`;
  return yamlFilesUnder(Object.keys(files), prefix).flatMap(([file, k]) => {
    const parsed = tryParse<Json>(files[k]!);
    if (!parsed) return [];
    const id = (parsed.id as string) ?? file;
    return [{ id, file, parsed }];
  });
}

// Board state (layout / edges)

/**
 * The board positions of `.artisan/editor.yaml`, keyed by Document key (`docKey`). A bare id,
 * the key before kinds were told apart, moves to every Document holding that id: a menu and
 * a command `shop` both start where `shop` was, and the next move sets each its own.
 */
export function parseEditorLayout(
  raw: unknown,
  documents: Project["documents"],
): Record<DocKey, { x: number; y: number }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<DocKey, { x: number; y: number }> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  // A key already written wins over the bare id it replaces.
  entries.sort(([a], [b]) => Number(isDocKey(a)) - Number(isDocKey(b)));
  for (const [id, v] of entries) {
    if (!v || typeof v !== "object") continue;
    const { x, y } = v as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    for (const key of boardKeys(id, documents)) out[key] = { x, y };
  }
  return out;
}

/** The keys a stored board key stands for: itself, or each Document of a bare id. */
function boardKeys(id: string, documents: Project["documents"]): DocKey[] {
  if (isDocKey(id)) return [id];
  return allDocuments({ documents })
    .filter((d) => d.doc.id === id)
    .map((d) => docKey(d.kind, id));
}

const ANCHOR_SIDES = new Set(["top", "right", "bottom", "left"]);

function parseAnchor(raw: unknown): EdgeAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const { side, t } = raw as { side?: unknown; t?: unknown };
  if (typeof side !== "string" || !ANCHOR_SIDES.has(side)) return null;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  return { side: side as EdgeAnchor["side"], t: Math.min(1, Math.max(0, t)) };
}

/**
 * The pinned link ends of `.artisan/editor.yaml`, keyed `source->target` by Document key. A
 * bare end (before kinds were told apart) goes to the first Document of that id; one naming
 * nothing in the project is dropped.
 */
export function parseEditorEdges(
  raw: unknown,
  documents: Project["documents"],
): Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const from = parseAnchor((v as { from?: unknown }).from);
    const to = parseAnchor((v as { to?: unknown }).to);
    if (!from && !to) continue;
    const [src = "", tgt = ""] = id.split("->");
    const source = isDocKey(src) ? src : boardKeys(src, documents)[0];
    const target = isDocKey(tgt) ? tgt : boardKeys(tgt, documents)[0];
    if (!source || !target) continue;
    out[`${source}->${target}`] = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return out;
}

// Lang files

/** lang/<lang>.yaml trees (or legacy flat maps) → key → { lang: value }. */
/**
 * Where the editor addresses its own texts: a key under these is a site's (a
 * Document's or a data source's, maybe one whose kind or model comes later), never
 * kept as read. `artisan.` holds the siteless presentation keys, written anyway.
 */
const EDITOR_LANG_NAMESPACES = ["menus.", "commands.", "dialogs.", "sources.", "artisan."];

function readTranslations(
  files: Record<string, string>,
  projectId: string,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [path, content] of Object.entries(files)) {
    const rel = relativeToProject(path, projectId);
    const m = /^lang\/([A-Za-z0-9_-]+)\.ya?ml$/.exec(rel);
    // `lang/fr.yml` and `lang/fr.yaml` both there: the `.yml` copy is read.
    if (!m || (rel.endsWith(".yaml") && `${path.slice(0, -".yaml".length)}.yml` in files)) continue;
    const lang = m[1]!;
    const parsed = tryParse<Record<string, unknown>>(content);
    if (!parsed || typeof parsed !== "object") continue;
    for (const [key, value] of Object.entries(flattenLangTree(parsed))) {
      let byLang = out[key];
      if (byLang === undefined) {
        byLang = {};
        out[key] = byLang;
      }
      byLang[lang] = value;
    }
  }
  return out;
}

// Captured items

/**
 * items/<id>.yml → CapturedItem. The file is the runtime truth (verbatim
 * `stackYaml`); name + display come from `.artisan/editor.yaml` `items:` when
 * present. That channel stays authoritative because it records what the
 * capture panel actually showed — notably a material enriched by the plugin's
 * custom-item reverse lookup, which the stack alone may not express.
 *
 * Without it (hand-added file, module-written item), the descriptor is derived
 * from the serialized stack by `parseCapturedStack`, which understands the
 * legacy Bukkit form, nested Paper components and the JSON/SNBT-encoded ones.
 * A root `display:` block still overrides the derivation (module migrators).
 * Byte-order sort keeps output deterministic.
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
    const stack = parseCapturedStack(content);
    const display: CapturedItem["display"] = {};
    if (stack.material) display.material = stack.material;
    if (stack.count !== undefined) display.count = stack.count;
    if (stack.name) display.name = stack.name;
    if (stack.headTexture) display.headTexture = stack.headTexture;
    // Real enchantments glint just as the explicit override does.
    if (stack.enchanted || (stack.enchants?.length ?? 0) > 0) display.enchanted = true;
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

// Data sources (data/v1 → domain, typed by Data models)

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
    case "item": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const out = { ...value } as Record<string, unknown>;
      for (const field of itemTextFields(value))
        out[field.name] = importDataValue(out[field.name], field.type, models, visited, ref);
      return out;
    }
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
      for (const f of type.fields)
        out[f.name] = importDataValue(obj[f.name], f.type, models, visited, ref);
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
      for (const [k, v] of Object.entries(obj))
        out[k] = importDataValue(v, type.of, models, visited, ref);
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
      for (const f of variant.fields)
        out[f.name] = importDataValue(obj[f.name], f.type, models, visited, ref);
      return out;
    }
    default:
      return value;
  }
}

// Public API

/** Module dirs must be sane slugs — rejects hostile keys like `__proto__`. */
const MODULE_DIR_RE = /^[a-z][a-z0-9_-]*$/;

/** Dirs and files owned by the core importer — everything else under a slug
 *  dir belongs to a module (`moduleData[ns].__files`). The document folders
 *  come from the kind registry: a kind nobody registered is module data. */
function corePrefixes(): string[] {
  return [
    ...listDocumentKinds().map((def) => `${def.dir}/`),
    "lang/",
    "items/",
    "templates/",
    "models/",
    "data/",
  ];
}
const CORE_FILES = new Set<string>([...MODULE_FILE_NAMES, "meta.yaml"]);

interface LegacyTemplate {
  alias: string;
  keyField: string;
  appearances: Appearance[];
}

/** An element binding as it arrives from a legacy menu file, before migration. */
type LegacyBinding = { alias: string; templateId?: string };

/**
 * Inline every legacy `templates/` ref into the element that carried it, then
 * re-address the inlined text to that element.
 *
 * Two elements may share one template. Cloning per element keeps their LText
 * nodes distinct, and the i18n entry is DUPLICATED (not moved) onto each
 * element's canonical key — moving it would strip the text off the second
 * element. The dead `item_templates.*` namespace goes once every menu is done.
 */
function inlineLegacyTemplates(
  menus: Menu[],
  templates: Map<string, LegacyTemplate>,
  i18nKeys: Record<string, Record<string, string>>,
): void {
  for (const menu of menus) {
    for (const el of menu.layers.flatMap((l) => l.elements)) {
      // `templateId` is off the domain type — menuV1ToDomain carries the legacy
      // wire ref through untyped, purely so this pass can consume it.
      const binding = (el.iterates ?? el.places) as LegacyBinding | undefined;
      const tplId = binding?.templateId;
      if (!binding || !tplId) continue;
      Reflect.deleteProperty(binding, "templateId");
      // Dangling ref: the element keeps its (empty) local fields — non-hermetic
      // by design, it just renders nothing.
      const tpl = templates.get(tplId);
      if (!tpl) continue;
      // A legacy template's list is addressed display-first (index 0 = the
      // `default` state), same as the element's own display + states.
      if (Object.keys(el.display).length === 0 && el.states.length === 0) {
        const [first, ...rest] = structuredClone(tpl.appearances);
        el.display = first ?? {};
        el.states = rest;
      }
      if (!binding.alias) binding.alias = tpl.alias;
      if (el.places && !el.places.keyField) el.places.keyField = tpl.keyField;
      // THIS element's sites only — a hand-authored key on an element that was
      // never template-bound must keep the address its lang file already uses.
      for (const site of visitElementLTexts(menu.id, el)) {
        const value = i18nKeys[site.lText.key];
        if (value) i18nKeys[site.key] = { ...value };
        site.lText.key = site.key;
      }
    }
  }
  for (const key of Object.keys(i18nKeys)) {
    if (key.startsWith("item_templates.")) delete i18nKeys[key];
  }
}

export interface ProjectFromFilesMeta {
  name?: string;
  /** The project's disk id (cf. `Project.diskId`). Default: the internal id. */
  diskId?: string;
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
  rawFiles: Record<string, string>,
  meta: ProjectFromFilesMeta = {},
): Project {
  // `files` keys are prefixed with the project's DISK id, which is not
  // necessarily the internal id (cf. `Project.diskId`). The prefix is rewritten
  // to the internal id once and for all: everything downstream addresses by
  // `baseOf(projectId)` and need not know the distinction.
  const files = normalizeProjectPrefix(rawFiles, projectId);
  const moduleFile = MODULE_FILE_NAMES.find((n) => getFile(files, projectId, n) !== null);
  const manifest =
    (moduleFile && tryParse<ManifestYaml>(getFile(files, projectId, moduleFile))) || {};
  const defaultLang = manifest.default_lang ?? "en";
  const now = new Date().toISOString();

  const diskTranslations = readTranslations(files, projectId);
  const i18nKeys: Record<string, Record<string, string>> = {};
  // Seed every disk translation so keys referenced via `{i18n:...}` (and any
  // extra keys the admin keeps in lang files) survive the import.
  for (const [key, langs] of Object.entries(diskTranslations)) i18nKeys[key] = { ...langs };
  const unsupported: string[] = [];
  // The keys a Document or a data source looks up below are theirs; the others are
  // kept as read (`Project.keptLangKeys`).
  const readKeys = new Set<string>();
  const translations = new Proxy(diskTranslations, {
    get(target, key, receiver) {
      if (typeof key === "string") readKeys.add(key);
      return Reflect.get(target, key, receiver);
    },
  });

  const convertOpts = { projectId, lang: defaultLang, translations };

  // Every Document the layout finds — at the module root or in themed folders
  // (`domain/documentLayout.ts`) — each file through its kind's codec. The
  // container is the project's only store of documents (ADR decision 10).
  // Originals (design `originaux-modules`): what the module ships, the owner's files over it.
  const originalsIndex = tryParse<{ required?: unknown }>(
    getFile(files, projectId, ORIGINALS_INDEX),
  );
  const required = Array.isArray(originalsIndex?.required)
    ? originalsIndex.required.filter((p): p is string => typeof p === "string")
    : [];
  const excludedRaw = Array.isArray(manifest.originals?.exclude)
    ? (manifest.originals.exclude as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const requiredFiles = new Set(required.map(sameFile));
  const layout = classifyDocumentLayout(
    projectPaths(files, projectId),
    kindDirs(),
    excludedRaw.filter((p) => !requiredFiles.has(sameFile(p))),
  );
  const documents = emptyDocuments();
  for (const def of listDocumentKinds()) {
    const entries = layout.documents
      .filter((e) => e.dir === def.dir)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const codec = documentCodec(def.kind);
    documents[def.kind] = entries.flatMap((entry) => {
      const y = tryParse<Json>(getFile(files, projectId, entry.path));
      if (!y) return [];
      const r = codec.parse({ ...y, id: entry.id }, convertOpts);
      Object.assign(i18nKeys, r.i18nKeys);
      unsupported.push(...r.unsupported);
      return [entry.folder ? { ...r.doc, folder: entry.folder } : r.doc];
    });
  }
  // Refused Document files are kept verbatim: a save must not delete them.
  const unreadFiles: Record<string, string> = {};
  for (const e of layout.errors) {
    if (!isOriginalPath(e.path)) unreadFiles[e.path] = getFile(files, projectId, e.path) ?? "";
    console.warn(`[projectFromFiles] ${projectId}: ${e.path} not read (${e.reason})`);
  }
  // Variants (design `variantes-modules`, `domain/variants.ts`): their menus and dialogs
  // read like the module's, its commands on the module's (`commandVariant.ts`), the rules from
  // `variants.yml` (the owner's, else the module's in `originals/`). Any other kind, or a
  // command the plugin would refuse, is kept verbatim (never an original: the server's).
  const allPaths = projectPaths(files, projectId);
  const variantsFile = variantsPath(allPaths);
  const variantPaths = [
    ...layout.variants.map((e) => e.path),
    ...(variantsFile ? [variantsFile] : []),
  ];
  /** A variant's Document, its command read on [base] (the module's command file, whole). */
  function readVersion(e: LayoutEntry, basePath: string | undefined): Document | null {
    const def = listDocumentKinds().find((d) => d.dir === e.dir);
    let y =
      def && VARIANT_KINDS.includes(def.kind)
        ? tryParse<Json>(getFile(files, projectId, e.path))
        : null;
    // A command's version holds only its steps: read on the module's command, whole.
    if (y && def?.kind === "command") {
      const base = basePath ? tryParse<Json>(getFile(files, projectId, basePath)) : null;
      y = base ? (mergeCommandVariant(base, y) as Json | null) : null;
    }
    if (!def || !y) return null;
    const r = documentCodec(def.kind).parse({ ...y, id: e.id }, convertOpts);
    Object.assign(i18nKeys, r.i18nKeys);
    unsupported.push(...r.unsupported);
    return e.folder ? ({ ...r.doc, folder: e.folder } as Document) : r.doc;
  }
  const kindOfDir = (dir: string) => listDocumentKinds().find((d) => d.dir === dir)!.kind;
  const byId = (a: LayoutEntry, b: LayoutEntry) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  let variants: ProjectVariants | undefined;
  if (variantsFile) {
    const rules = rulesFromYaml(tryParse<Json>(getFile(files, projectId, variantsFile)));
    const names = [
      ...new Set([...rules.map((r) => r.variant), ...layout.variants.map((e) => e.variant!)]),
    ];
    const byVariant: ProjectVariants["documents"] = {};
    for (const e of [...layout.variants].sort(byId)) {
      const own = layout.documents.find((d) => d.dir === e.dir && d.id === e.id);
      const doc = readVersion(e, own?.path);
      if (!doc) {
        if (!isOriginalPath(e.path)) unreadFiles[e.path] = getFile(files, projectId, e.path) ?? "";
        continue;
      }
      const kind = kindOfDir(e.dir);
      const ofVariant = byVariant[e.variant!] ?? {};
      byVariant[e.variant!] = ofVariant;
      ofVariant[kind] = [...(ofVariant[kind] ?? []), doc];
    }
    variants = { rules, names, documents: byVariant };
  }
  // What the module ships, as shipped: each Document of `originals/`, the ones the owner's
  // files cover or exclude included, for the comparison and the way back.
  const originalPaths = allPaths.filter(isOriginalPath);
  let originals: ProjectOriginals | undefined;
  if (originalPaths.length > 0) {
    const shippedPaths = originalPaths.map((p) => p.slice(ORIGINALS_DIR.length + 1));
    const shipped = classifyDocumentLayout(
      // The variants' folder only when the module ships its rules or the owner has some.
      variantsFile && !shippedPaths.some((p) => !p.includes("/") && yamlStem(p) === VARIANTS_FILE)
        ? [...shippedPaths, `${VARIANTS_FILE}${YAML_EXT}`]
        : shippedPaths,
      kindDirs(),
    );
    const at = (e: LayoutEntry): LayoutEntry => ({ ...e, path: `${ORIGINALS_DIR}/${e.path}` });
    const docs: ProjectOriginals["documents"] = {};
    const put = (variant: string, kind: string, doc: Document) => {
      const ofVariant = docs[variant] ?? {};
      docs[variant] = ofVariant;
      ofVariant[kind] = [...(ofVariant[kind] ?? []), doc];
    };
    for (const e of [...shipped.documents].sort(byId)) {
      const kind = kindOfDir(e.dir);
      const y = tryParse<Json>(getFile(files, projectId, at(e).path));
      if (!y) continue;
      const r = documentCodec(kind).parse({ ...y, id: e.id }, convertOpts);
      Object.assign(i18nKeys, r.i18nKeys);
      put("", kind, e.folder ? ({ ...r.doc, folder: e.folder } as Document) : r.doc);
    }
    for (const e of [...shipped.variants].sort(byId)) {
      const base = shipped.documents.find((d) => d.dir === e.dir && d.id === e.id);
      const doc = readVersion(at(e), base ? at(base).path : undefined);
      if (doc) put(e.variant!, kindOfDir(e.dir), doc);
    }
    const shippedRules = shippedPaths.find(
      (p) => !p.includes("/") && yamlStem(p) === VARIANTS_FILE,
    );
    originals = {
      documents: docs,
      ...(shippedRules
        ? {
            rules: rulesFromYaml(
              tryParse<Json>(getFile(files, projectId, `${ORIGINALS_DIR}/${shippedRules}`)),
            ),
          }
        : {}),
      required,
      excluded: excludedRaw,
    };
  }
  const claimedPaths = new Set([
    ...layout.documents.map((e) => e.path),
    ...layout.errors.map((e) => e.path),
    ...variantPaths,
    // The server's to write: never kept as the owner's files.
    ...originalPaths,
  ]);
  const menus = menusOf({ documents });

  // Shared i18n bridge for the file kinds without a per-document converter
  // (templates, data sources).
  function ref(key: string): LText {
    const tr = translations[key];
    if (tr) i18nKeys[key] = { ...tr };
    return { key: key as I18nKey };
  }
  function text(raw: string | Record<string, string> | undefined): LText {
    // Field-local map: the slot's languages travel with the document.
    if (raw && typeof raw === "object") {
      const key = newI18nKey();
      i18nKeys[key] = { ...raw };
      return { key };
    }
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
    defaultLang,
  });

  // Legacy templates/ migration (one-way)
  // Item templates used to be a PROJECT-level shared view that elements bound
  // to by ref. A set now lives on the element that renders it, so a legacy
  // `templates/<id>.yaml` still on disk is read here and inlined below — never
  // written back. `name` and `group_by` are dropped: they only ever fed the
  // (removed) project-level Sets library and had zero runtime effect.
  const legacyTemplates = new Map<string, LegacyTemplate>(
    scanDir(files, projectId, "templates").map(({ id, parsed: y }) => [
      id,
      {
        alias: (y.alias as string) ?? "",
        keyField: (y.key_field as string) ?? "",
        // Two shapes meet here, and both must be read.
        //
        // `appearances:` is the older one; since then, a template is written like an
        // Element — FLAT display plus `states`. Reading only the former gave an EMPTY
        // list for a perfectly valid file: the element inherited an empty display,
        // and the menu showed without items, without a single message. A migration
        // reader must be tolerant; it is the writer that must be canonical.
        appearances: Array.isArray(y.appearances)
          ? (y.appearances as Json[]).map(appearance)
          : [appearance(y), ...((y.states as Json[]) ?? []).map(appearance)],
      },
    ]),
  );
  inlineLegacyTemplates(menus, legacyTemplates, i18nKeys);

  // Data models: models/<id>.yaml (model/v1), fields verbatim — the lossless
  // typing store. A models/ file that is ONLY a `model:` ref (ADR
  // bare-data-files ⑤: one-line link from a bare source to a declared model)
  // never becomes a Data model itself — it's recorded as a source → model ref.
  // Ref-only files (source → model link) and, for docs emitted at a SOURCE's
  // filename (owned models), the filename → doc-id/name mapping — both feed
  // the bare-source schema resolution below.
  const modelRefs: Record<string, { model: string; name?: string; version?: number }> = {};
  const modelFileDoc: Record<string, { docId: string; name?: string }> = {};
  // Keyed by the FILE NAME: the writer emits a source's model at
  // models/<sourceId>.yaml whatever its `id:` (an editor-created table's model
  // is `dm_…`), and the lookup beside the data is by source id. The doc's own
  // `id:` is a fallback key only, first file wins — the plugin's
  // ProjectReader.readProjectModels applies the same rule.
  const modelDocById: Record<string, { docId: string; name?: string }> = {};
  const dataModels: DataModel[] = scanDir(files, projectId, "models").flatMap(
    ({ id, file, parsed: y }) => {
      const fields = ((y.fields as ModelField[]) ?? []) as ModelField[];
      if (fields.length === 0 && typeof y.model === "string") {
        modelRefs[file] = {
          model: y.model,
          ...(typeof y.name === "string" ? { name: y.name } : {}),
          ...(typeof y.model_version === "number" ? { version: y.model_version } : {}),
        };
        return [];
      }
      // Identity lives INSIDE the doc when present (owned model emitted at the
      // source's filename — ADR bare-data-files ⑤); the filename is the lookup.
      const docId = id;
      const doc = { docId, ...(typeof y.name === "string" ? { name: y.name } : {}) };
      modelFileDoc[file] = doc;
      modelDocById[docId] ??= doc;
      return [
        {
          id: docId as DataModelId,
          name: (y.name as string) ?? docId,
          keyField: (y.key_field as string) ?? "id",
          ...(y.master_detail === true ? { masterDetail: true } : {}),
          fields,
        },
      ];
    },
  );

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
  const besideOf = (sourceId: string): { model?: string; name?: string; version?: number } => {
    const r = modelRefs[sourceId];
    if (r) return r;
    const d = modelFileDoc[sourceId] ?? modelDocById[sourceId];
    if (d) return { model: d.docId, name: d.name };
    return {};
  };
  // Top-level files only — nested paths belong to per-row source dirs below.
  const topLevelDataSources = yamlFilesUnder(Object.keys(files), dataPrefix).flatMap(
    ([fileId, k]) => {
      const raw = tryParse<unknown>(files[k]!);
      if (!raw) return [];
      // Bare list = table, bare mapping (no data/* header) = object source
      // (ADR bare-data-files ②/③) — values only, schema resolved beside.
      const header = leadingHandComment(files[k]!);
      if (Array.isArray(raw)) {
        const b = besideOf(fileId);
        return [
          {
            id: fileId,
            parsed: {
              shape: "table",
              model: b.model,
              name: b.name,
              ...(b.version !== undefined ? { model_version: b.version } : {}),
              ...(header ? { header_comment: header } : {}),
              rows: raw,
            } as Json,
          },
        ];
      }
      const parsed = raw as Json;
      if (typeof parsed !== "object") return [];
      if (!String(parsed.schema ?? "").startsWith("data/")) {
        const b = besideOf(fileId);
        return [
          {
            id: fileId,
            parsed: {
              shape: "config",
              model: b.model,
              name: b.name,
              ...(header ? { header_comment: header } : {}),
              value: parsed,
            } as Json,
          },
        ];
      }
      const id = (parsed.id as string) ?? fileId;
      return [{ id, parsed }];
    },
  );
  // Per-row dirs: any data/<dir>/ holding row files — `_source.yaml` is
  // OPTIONAL (absent → all files, byte-sorted; present → legacy full meta or
  // minimal `model:` + `order:`).
  const perRowSourceDirs = [
    ...new Set(
      Object.keys(files)
        .filter(
          (k) =>
            k.startsWith(dataPrefix) && isYamlPath(k) && k.slice(dataPrefix.length).includes("/"),
        )
        .map((k) => k.slice(dataPrefix.length).split("/", 1)[0]!),
    ),
  ].sort();
  const perRowParsed = perRowSourceDirs.flatMap((dir) => {
    const rowPrefix = `${dataPrefix}${dir}/`;
    const rowFiles = new Map(yamlFilesUnder(Object.keys(files), rowPrefix));
    const metaPath = rowFiles.get("_source");
    const metaRawText = metaPath === undefined ? undefined : files[metaPath];
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
    const onDisk = [...rowFiles.keys()].filter((n) => n !== "_source");
    const order: string[] = Array.isArray(meta.order) ? meta.order.map(String) : [];
    // Declared order first, then hand-added files not in the order (byte-sorted).
    const names = [
      ...order.filter((n) => onDisk.includes(n)),
      ...onDisk.filter((n) => !order.includes(n)).sort(),
    ];
    const rows = names.flatMap((n) => {
      const row = tryParse<Json>(files[rowFiles.get(n)!] ?? null);
      return row ? [row] : [];
    });
    return [
      { id: (meta.id as string) ?? dir, parsed: { ...meta, rows, granularity: "row" } as Json },
    ];
  });
  const dataSources: DataSource[] = [...topLevelDataSources, ...perRowParsed]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, parsed: y }) => {
      const nameFromModel = dataModels.find((m) => String(m.id) === y.model)?.name;
      const name = (y.name as string) ?? nameFromModel ?? id;
      if (y.shape === "config") {
        // Fields: inline (legacy) or the beside-the-data model's (bare form).
        const fields =
          y.fields != null
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
      if (
        typeof y.model === "string" &&
        y.model.includes(":") &&
        !dataModels.some((m) => m.id === y.model)
      ) {
        const rowType: ModelFieldType = {
          kind: "object",
          fields: ((y.fields as Json[]) ?? []).map(fieldOfWire),
        };
        const rows = ((y.rows as Json[]) ?? []).map(
          (r) =>
            importDataValue(r, rowType, dataModels, new Set(), ltData) as Record<string, unknown>,
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
          importDataValue(r, rowType, dataModels, new Set([modelId]), ltData) as Record<
            string,
            unknown
          >,
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

  const editorState = tryParse<EditorStateYaml>(
    getFile(files, projectId, ".artisan/editor.yaml"),
  ) ?? {
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
    if (claimedPaths.has(rel)) continue;
    if (CORE_FILES.has(rel) || corePrefixes().some((p) => rel.startsWith(p))) continue;
    const slash = rel.indexOf("/");
    if (slash <= 0) continue; // top-level unknown files (and .artisan/*): ignored
    const dir = rel.slice(0, slash);
    if (!MODULE_DIR_RE.test(dir) || dir in Object.prototype) continue;
    let mod = moduleData[dir];
    if (mod === undefined) {
      mod = { __files: {} };
      moduleData[dir] = mod;
    }
    mod.__files[rel.slice(slash + 1)] = content;
  }

  const folders = normalizeFolderMeta(editorState.folders);
  const canvasEdges = parseEditorEdges(editorState.edges, documents);

  const project: Project = {
    id: projectId,
    name:
      manifest.module === "boutique" &&
      (!meta.name || meta.name === projectId || meta.name === meta.diskId)
        ? "Boutique"
        : (meta.name ?? projectId),
    ...(meta.diskId && meta.diskId !== projectId ? { diskId: meta.diskId } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    // `source` is cosmetic (badge) and DB/file-less — default to the common case.
    source: meta.source ?? "user_created",
    ...(meta.serverKeyId ? { serverKeyId: meta.serverKeyId } : {}),
    createdAt: meta.createdAt ?? now,
    updatedAt: meta.updatedAt ?? now,
    documents,
    ...(capturedItems.length > 0 ? { capturedItems } : {}),
    assets: [],
    dataSources,
    ...(dataModels.length > 0 ? { dataModels } : {}),
    i18nKeys: i18nKeys as Project["i18nKeys"],
    defaultLang,
    ...(manifest.lore_max_width ? { loreMaxWidth: manifest.lore_max_width } : {}),
    ...(manifest.escape_goes_back === true ? { escapeGoesBack: true } : {}),
    canvasLayout: parseEditorLayout(editorState.layout, documents),
    ...(Object.keys(folders).length ? { folders } : {}),
    ...(Object.keys(canvasEdges).length > 0 ? { canvasEdges } : {}),
    ...(Object.keys(moduleData).length > 0 ? { moduleData: { ...moduleData } } : {}),
    ...(Object.keys(unreadFiles).length > 0 ? { unreadFiles } : {}),
    ...(variants ? { variants } : {}),
    ...(originals ? { originals } : {}),
    ...(typeof manifest.module === "string" && manifest.module
      ? { ownerModule: manifest.module }
      : {}),
  };

  // Menus / commands / dialogs: same reconnection as the data-source block
  // above, over the whole tree. An inline document's literal was imported as a
  // minted key; its other languages sit in lang/ at the site's canonical
  // address, so bring node and address back together.
  adoptAddressedTranslations(project, translations);

  const keptLangKeys = Object.keys(diskTranslations)
    .filter((key) => !readKeys.has(key) && !EDITOR_LANG_NAMESPACES.some((ns) => key.startsWith(ns)))
    .sort();
  if (keptLangKeys.length > 0) project.keptLangKeys = keptLangKeys;

  // The base lore is kept without writing anything: leading `{base.lore}`
  // inherited from when it had to be requested are removed (cf. baseLore.ts).
  normalizeBaseLore(project);

  if (unsupported.length > 0) {
    console.warn(
      `[projectFromFiles] ${projectId}: dropped unsupported constructs: ${unsupported.join(", ")}`,
    );
  }

  return project;
}

/**
 * Reads the Documents of kinds registered after the Project was read (ADR
 * `runtime-editor-modules`): a module's view arrives with the server's presence, which
 * may come after the Project. Until then its files were kept verbatim in
 * `moduleData[<first folder>].__files` (re-exported as is, so nothing was lost); this
 * moves each Document the layout now recognizes — `<kind dir>/<id>.yaml` at the root
 * or under themed folders — into `project.documents[kind]` through the kind's codec.
 * A file that does not parse, or whose id is taken, stays where it was. Returns how
 * many Documents were adopted. Mutates `project` (an immer draft in the store).
 */
export function adoptLateDocuments(project: Project): number {
  const moduleData = project.moduleData as Record<string, unknown> | undefined;
  if (!moduleData) return 0;
  const raw = new Map<string, { files: Record<string, string>; ns: string; rel: string }>();
  for (const [ns, data] of Object.entries(moduleData)) {
    const files = (data as { __files?: Record<string, string> } | undefined)?.__files;
    if (!files || typeof files !== "object") continue;
    for (const rel of Object.keys(files)) raw.set(`${ns}/${rel}`, { files, ns, rel });
  }
  let adopted = 0;
  const layout = classifyDocumentLayout(raw.keys(), kindDirs());
  for (const def of listDocumentKinds()) {
    const codec = documentCodec(def.kind);
    for (const entry of layout.documents.filter((e) => e.dir === def.dir)) {
      const docs = mutableDocuments(project, def.kind);
      if (docs.some((d) => d.id === entry.id)) continue;
      const source = raw.get(entry.path)!;
      const y = tryParse<Json>(source.files[source.rel] ?? null);
      if (!y || typeof y !== "object") continue;
      const r = codec.parse(
        { ...y, id: entry.id },
        { projectId: project.id, lang: project.defaultLang, translations: project.i18nKeys },
      );
      for (const [key, langs] of Object.entries(r.i18nKeys)) {
        project.i18nKeys[key as I18nKey] ??= langs;
      }
      docs.push(entry.folder ? { ...r.doc, folder: entry.folder } : r.doc);
      delete source.files[source.rel];
      if (Object.keys(source.files).length === 0) delete moduleData[source.ns];
      adopted++;
    }
  }
  return adopted;
}
