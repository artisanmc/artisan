import { createLText, deleteLText, getText } from "@/lib/i18n";
import type {
  DataModel,
  DataModelId,
  DataSource,
  DataSourceId,
  FieldType,
  LText,
  ModelField,
  ModelFieldType,
  Project,
} from "./types";

/**
 * Helpers over {@link DataModel} / Project sources. Cf. ADR
 * `project-sources-and-data-models` + CONTEXT.md "Data model".
 */

/** Canonical authored name used for source identity and i18n paths. */
export function normalizeDataSourceName(name: string): string {
  return name.trim().toLowerCase();
}

export function findDataModel(pack: Project, id: DataModelId): DataModel | undefined {
  return (pack.dataModels ?? []).find((m) => m.id === id);
}

/** Model ids referenced (at any depth) by a field type. */
function* modelRefs(type: ModelFieldType): Generator<DataModelId> {
  switch (type.kind) {
    case "model":
      yield type.ref;
      break;
    case "list":
      yield* modelRefs(type.of);
      break;
    case "object":
      for (const f of type.fields) yield* modelRefs(f.type);
      break;
    default:
      break;
  }
}

/**
 * Would adding a `{kind:"model", ref}` field to `host` close a reference
 * loop? True when `ref` (or anything it transitively references) reaches
 * `host`. Edit-time guard — the rest of the code is defensive anyway.
 */
export function wouldCreateModelCycle(
  models: DataModel[],
  host: DataModelId,
  ref: DataModelId,
): boolean {
  const byId = new Map(models.map((m) => [m.id, m]));
  const stack = [ref];
  const seen = new Set<DataModelId>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === host) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const model = byId.get(id);
    if (!model) continue;
    for (const f of model.fields) for (const r of modelRefs(f.type)) stack.push(r);
  }
  return false;
}

/**
 * Default value a fresh row/field gets for a declared type. ltext seeds the
 * unallocated LText sentinel (`{key:""}`) so `mintLTexts` allocates it; item
 * seeds an empty ref (dangling until picked — allowed, non-hermetic).
 */
export function defaultValueForModelType(
  type: ModelFieldType,
  models: DataModel[] = [],
  visited: Set<DataModelId> = new Set(),
): unknown {
  switch (type.kind) {
    case "string":
    case "item":
    case "minimessage":
    case "minimessage_multiline":
      return "";
    case "ltext":
      return { key: "" };
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "list":
      return [];
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const f of type.fields) obj[f.name] = defaultValueForModelType(f.type, models, visited);
      return obj;
    }
    case "model": {
      if (visited.has(type.ref)) return {};
      const model = models.find((m) => m.id === type.ref);
      if (!model) return {};
      const next = new Set(visited).add(type.ref);
      return defaultValueForModelType({ kind: "object", fields: model.fields }, models, next);
    }
  }
}

/**
 * Project a declared {@link ModelFieldType} onto the legacy inferred
 * {@link FieldType} vocabulary — what the placeholder catalog and the sets
 * tooling still speak. ltext/item collapse to string (that's what they
 * interpolate as); model refs are resolved (cycle-defensive).
 */
export function modelFieldTypeToFieldType(
  type: ModelFieldType,
  models: DataModel[] = [],
  visited: Set<DataModelId> = new Set(),
): FieldType {
  switch (type.kind) {
    case "string":
    case "ltext":
    case "item":
    case "minimessage":
    case "minimessage_multiline":
      return { kind: "string" };
    case "number":
    case "integer":
    case "boolean":
      return { kind: type.kind };
    case "list":
      return { kind: "list", of: modelFieldTypeToFieldType(type.of, models, visited) };
    case "object":
      return {
        kind: "object",
        fields: type.fields.map((f) => ({
          name: f.name,
          type: modelFieldTypeToFieldType(f.type, models, visited),
        })),
      };
    case "model": {
      if (visited.has(type.ref)) return { kind: "object", fields: [] };
      const model = models.find((m) => m.id === type.ref);
      if (!model) return { kind: "object", fields: [] };
      const next = new Set(visited).add(type.ref);
      return modelFieldTypeToFieldType({ kind: "object", fields: model.fields }, models, next);
    }
  }
}

/** Legacy `FieldType` of a source: table → list of its model's shape; config → object. */
export function sourceFieldType(pack: Project, ds: DataSource): FieldType {
  const models = pack.dataModels ?? [];
  if (ds.shape === "table") {
    return {
      kind: "list",
      of: modelFieldTypeToFieldType({ kind: "model", ref: ds.modelId }, models),
    };
  }
  return modelFieldTypeToFieldType({ kind: "object", fields: ds.fields }, models);
}

/** `FieldType` of a table source (list of object). See {@link sourceFieldType}. */
export function tableRowType(pack: Project, ds: DataSource & { shape: "table" }): FieldType {
  return sourceFieldType(pack, ds);
}

/**
 * Is a Data model still referenced by anything in the pack — a table source's
 * `modelId`, a config source's fields, or another model's fields? Used by the
 * delete guard and by auto-model GC when its table is removed.
 */
export function isDataModelReferenced(
  pack: Project,
  id: DataModelId,
  ignoreSourceId?: DataSource["id"],
): boolean {
  const refsInFields = (fields: DataModel["fields"]): boolean =>
    fields.some((f) => [...modelRefs(f.type)].includes(id));
  for (const ds of pack.dataSources ?? []) {
    if (ds.id === ignoreSourceId) continue;
    if (ds.shape === "table" && ds.modelId === id) return true;
    if (ds.shape === "config" && refsInFields(ds.fields)) return true;
  }
  for (const m of pack.dataModels ?? []) {
    if (m.id !== id && refsInFields(m.fields)) return true;
  }
  return false;
}

/** Would introducing `type` into `host`'s fields close a model-ref loop? */
export function wouldTypeCreateModelCycle(
  models: DataModel[],
  host: DataModelId,
  type: ModelFieldType,
): boolean {
  for (const ref of modelRefs(type)) {
    if (wouldCreateModelCycle(models, host, ref)) return true;
  }
  return false;
}

/** Root declared fields of a source: table → its model's, config → its own. */
export function sourceRootFields(pack: Project, ds: DataSource): ModelField[] {
  if (ds.shape === "table") {
    return (pack.dataModels ?? []).find((m) => m.id === ds.modelId)?.fields ?? [];
  }
  return ds.fields;
}

/**
 * Declared type at a value path within a source's row (or config value).
 * String segments name object/model fields; numeric segments index lists.
 */
export function sourceTypeAtPath(
  pack: Project,
  ds: DataSource,
  path: (string | number)[],
): ModelFieldType | undefined {
  const models = pack.dataModels ?? [];
  let type: ModelFieldType = { kind: "object", fields: sourceRootFields(pack, ds) };
  const visited = new Set<DataModelId>();
  for (const seg of path) {
    while (type.kind === "model") {
      if (visited.has(type.ref)) return undefined;
      visited.add(type.ref);
      const model = models.find((m) => m.id === (type as { ref: DataModelId }).ref);
      if (!model) return undefined;
      type = { kind: "object", fields: model.fields };
    }
    if (typeof seg === "number") {
      if (type.kind !== "list") return undefined;
      type = type.of;
    } else {
      if (type.kind !== "object") return undefined;
      const f: ModelField | undefined = type.fields.find((x) => x.name === seg);
      if (!f) return undefined;
      type = f.type;
    }
  }
  return type;
}

/**
 * The accepted reset (ADR): legacy sources (pre-declared-schema, no `shape`)
 * are dropped on load, never migrated. Also seeds `dataModels` on older
 * stored projects. Idempotent; run at the project-load boundary.
 */
export function normalizeDataSources(pack: Project): void {
  pack.dataSources = (pack.dataSources ?? []).filter(
    (d) => (d as { shape?: string }).shape === "table" || (d as { shape?: string }).shape === "config",
  );
  if (!pack.dataModels) pack.dataModels = [];
}

// ── Field edits: schema change + synchronous value migration ─────────────────
// "Data migrated, references dangled" (ADR project-sources-and-data-models):
// the editor owns models, rows, and config values — one edit rewrites them all
// in the same transaction. Consumers of a changed field ({alias.field}
// interpolations, Placements) are never rewritten; they dangle.

export type FieldEditTarget =
  | { kind: "model"; modelId: DataModelId }
  | { kind: "config"; sourceId: DataSourceId };

export type FieldEdit =
  | { op: "add"; path: string[]; field: ModelField }
  | { op: "rename"; path: string[]; oldName: string; newName: string }
  | { op: "remove"; path: string[]; name: string }
  | { op: "retype"; path: string[]; name: string; newType: ModelFieldType };

function isLTextNode(v: unknown): v is LText {
  return typeof v === "object" && v !== null && typeof (v as { key?: unknown }).key === "string";
}

/** Release every i18n key held by a value of the given declared type. */
export function releaseValueLTexts(
  pack: Project,
  value: unknown,
  type: ModelFieldType,
  visited: Set<DataModelId> = new Set(),
): void {
  switch (type.kind) {
    case "ltext":
      if (isLTextNode(value)) deleteLText(pack, value);
      return;
    case "list":
      if (Array.isArray(value)) for (const el of value) releaseValueLTexts(pack, el, type.of, visited);
      return;
    case "object":
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        for (const f of type.fields) releaseValueLTexts(pack, obj[f.name], f.type, visited);
      }
      return;
    case "model": {
      if (visited.has(type.ref)) return;
      const model = (pack.dataModels ?? []).find((m) => m.id === type.ref);
      if (!model) return;
      const next = new Set(visited).add(type.ref);
      releaseValueLTexts(pack, value, { kind: "object", fields: model.fields }, next);
      return;
    }
    default:
      return;
  }
}

/**
 * Navigate a field list along a path of inline object segments (list wrappers
 * unwrap transparently). Returns null when the path crosses a scalar or a
 * model ref — a model's own fields are edited on that model, never through a
 * ref.
 */
function fieldListAt(fields: ModelField[], path: string[]): ModelField[] | null {
  let current = fields;
  for (const seg of path) {
    const f = current.find((x) => x.name === seg);
    if (!f) return null;
    let t = f.type;
    while (t.kind === "list") t = t.of;
    if (t.kind !== "object") return null;
    current = t.fields;
  }
  return current;
}

/** Apply the schema half of an edit to a field list. No-op on bad paths/dupes. */
function applyEditToFields(fields: ModelField[], edit: FieldEdit): void {
  const list = fieldListAt(fields, edit.path);
  if (!list) return;
  switch (edit.op) {
    case "add":
      if (!list.some((f) => f.name === edit.field.name)) list.push(edit.field);
      return;
    case "rename": {
      const f = list.find((x) => x.name === edit.oldName);
      if (f && !list.some((x) => x.name === edit.newName)) f.name = edit.newName;
      return;
    }
    case "remove": {
      const i = list.findIndex((x) => x.name === edit.name);
      if (i >= 0) list.splice(i, 1);
      return;
    }
    case "retype": {
      const f = list.find((x) => x.name === edit.name);
      if (f) f.type = edit.newType;
      return;
    }
  }
}

/** Kinds whose stored value is a plain string — interchangeable on retype. */
const STRING_LIKE_KINDS: ReadonlySet<ModelFieldType["kind"]> = new Set([
  "string",
  "item",
  "minimessage",
  "minimessage_multiline",
]);

/** Best-effort scalar coercion for retype; falls back to the new default. */
function coerceForRetype(
  pack: Project,
  value: unknown,
  oldType: ModelFieldType,
  newType: ModelFieldType,
): unknown {
  const models = pack.dataModels ?? [];
  if (oldType.kind === newType.kind) return value;
  if (oldType.kind === "ltext" && STRING_LIKE_KINDS.has(newType.kind)) {
    const s = isLTextNode(value) ? getText(pack, value, pack.defaultLang) : "";
    if (isLTextNode(value)) deleteLText(pack, value);
    return s;
  }
  if (newType.kind === "ltext" && STRING_LIKE_KINDS.has(oldType.kind)) {
    return createLText(pack, typeof value === "string" ? value : "", pack.defaultLang);
  }
  if (STRING_LIKE_KINDS.has(oldType.kind) && STRING_LIKE_KINDS.has(newType.kind)) {
    return typeof value === "string" ? value : "";
  }
  if (oldType.kind === "number" && newType.kind === "integer") {
    return typeof value === "number" ? Math.round(value) : 0;
  }
  if (oldType.kind === "integer" && newType.kind === "number") {
    return typeof value === "number" ? value : 0;
  }
  if (
    (oldType.kind === "number" || oldType.kind === "integer") &&
    STRING_LIKE_KINDS.has(newType.kind)
  ) {
    return typeof value === "number" ? String(value) : "";
  }
  if (
    STRING_LIKE_KINDS.has(oldType.kind) &&
    (newType.kind === "number" || newType.kind === "integer")
  ) {
    const n = Number(value);
    return Number.isFinite(n) ? (newType.kind === "integer" ? Math.round(n) : n) : 0;
  }
  releaseValueLTexts(pack, value, oldType);
  return defaultValueForModelType(newType, models);
}

/** Apply the value half of an edit to one instance object of the edited list. */
function migrateInstance(pack: Project, instance: unknown, edit: FieldEdit): void {
  // Walk down edit.path; arrays fan out (list-of-object segments).
  const targets: unknown[] = [instance];
  for (const seg of edit.path) {
    const next: unknown[] = [];
    for (const t of targets) {
      const v =
        typeof t === "object" && t !== null && !Array.isArray(t)
          ? (t as Record<string, unknown>)[seg]
          : undefined;
      if (Array.isArray(v)) next.push(...v);
      else if (v !== undefined) next.push(v);
    }
    targets.length = 0;
    targets.push(...next);
  }
  const models = pack.dataModels ?? [];
  for (const t of targets) {
    if (typeof t !== "object" || t === null || Array.isArray(t)) continue;
    const obj = t as Record<string, unknown>;
    switch (edit.op) {
      case "add":
        if (!(edit.field.name in obj)) {
          obj[edit.field.name] = defaultValueForModelType(edit.field.type, models);
        }
        break;
      case "rename":
        if (edit.oldName in obj) {
          obj[edit.newName] = obj[edit.oldName];
          delete obj[edit.oldName];
        }
        break;
      case "remove":
        break; // handled by caller (needs the old field type for i18n release)
      case "retype":
        break; // handled by caller (needs the old field type)
    }
  }
}

/** remove/retype need the pre-edit field type — resolved by the caller. */
function migrateInstanceTyped(
  pack: Project,
  instance: unknown,
  edit: FieldEdit,
  oldFieldType: ModelFieldType | undefined,
): void {
  if (edit.op === "add" || edit.op === "rename") {
    migrateInstance(pack, instance, edit);
    return;
  }
  const targets: unknown[] = [instance];
  for (const seg of edit.path) {
    const next: unknown[] = [];
    for (const t of targets) {
      const v =
        typeof t === "object" && t !== null && !Array.isArray(t)
          ? (t as Record<string, unknown>)[seg]
          : undefined;
      if (Array.isArray(v)) next.push(...v);
      else if (v !== undefined) next.push(v);
    }
    targets.length = 0;
    targets.push(...next);
  }
  for (const t of targets) {
    if (typeof t !== "object" || t === null || Array.isArray(t)) continue;
    const obj = t as Record<string, unknown>;
    if (edit.op === "remove") {
      if (oldFieldType) releaseValueLTexts(pack, obj[edit.name], oldFieldType);
      delete obj[edit.name];
    } else if (edit.op === "retype") {
      if (oldFieldType)
        obj[edit.name] = coerceForRetype(pack, obj[edit.name], oldFieldType, edit.newType);
    }
  }
}

/**
 * Visit every value instance governed by `modelId` across the pack — table
 * rows of that model plus every nested occurrence reached through model refs
 * in the declared types of other sources. Cycle-defensive.
 */
function forEachModelInstance(
  pack: Project,
  modelId: DataModelId,
  visit: (instance: unknown) => void,
): void {
  const models = pack.dataModels ?? [];
  const walk = (type: ModelFieldType, value: unknown, visited: Set<DataModelId>): void => {
    switch (type.kind) {
      case "list":
        if (Array.isArray(value)) for (const el of value) walk(type.of, el, visited);
        return;
      case "object":
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          const obj = value as Record<string, unknown>;
          for (const f of type.fields) walk(f.type, obj[f.name], visited);
        }
        return;
      case "model": {
        if (visited.has(type.ref)) return;
        if (type.ref === modelId) visit(value);
        const model = models.find((m) => m.id === type.ref);
        if (!model) return;
        const next = new Set(visited).add(type.ref);
        walk({ kind: "object", fields: model.fields }, value, next);
        return;
      }
      default:
        return;
    }
  };
  for (const ds of pack.dataSources ?? []) {
    if (ds.shape === "table") {
      for (const row of ds.rows) walk({ kind: "model", ref: ds.modelId }, row, new Set());
    } else {
      walk({ kind: "object", fields: ds.fields }, ds.value, new Set());
    }
  }
}

/**
 * One field edit = schema change + synchronous migration of every value the
 * editor owns (all instances across tables, nested model refs, config
 * objects), with ltext release/coercion. Immer-safe (call inside a producer).
 */
export function applyFieldEdit(pack: Project, target: FieldEditTarget, edit: FieldEdit): void {
  const ownerFields =
    target.kind === "model"
      ? (pack.dataModels ?? []).find((m) => m.id === target.modelId)?.fields
      : (() => {
          const ds = (pack.dataSources ?? []).find((d) => d.id === target.sourceId);
          return ds?.shape === "config" ? ds.fields : undefined;
        })();
  if (!ownerFields) return;

  // Pre-edit field type (remove/retype migrations need it).
  let oldFieldType: ModelFieldType | undefined;
  if (edit.op === "remove" || edit.op === "retype") {
    const list = fieldListAt(ownerFields, edit.path);
    oldFieldType = list?.find((f) => f.name === edit.name)?.type;
    if (!oldFieldType) return;
  }

  // Values first (walkers rely on the pre-edit schema), then the schema.
  if (target.kind === "model") {
    forEachModelInstance(pack, target.modelId, (instance) =>
      migrateInstanceTyped(pack, instance, edit, oldFieldType),
    );
  } else {
    const ds = (pack.dataSources ?? []).find((d) => d.id === target.sourceId);
    if (ds?.shape === "config") migrateInstanceTyped(pack, ds.value, edit, oldFieldType);
  }
  applyEditToFields(ownerFields, edit);
}
