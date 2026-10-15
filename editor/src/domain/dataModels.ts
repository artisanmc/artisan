import { createLText, deleteLText, getText } from "@/lib/i18n";
import { adoptBareLTexts } from "./i18nSites";
import { applyModelMigrations, type ModelMigration } from "./modelMigrations";
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

export function findDataModel(project: Project, id: DataModelId): DataModel | undefined {
  return (project.dataModels ?? []).find((m) => m.id === id);
}

/** Model ids referenced (at any depth) by a field type. */
function* modelRefs(type: ModelFieldType): Generator<DataModelId> {
  switch (type.kind) {
    case "model":
      yield type.ref;
      break;
    case "list":
    case "map":
      yield* modelRefs(type.of);
      break;
    case "object":
      for (const f of type.fields) yield* modelRefs(f.type);
      break;
    case "union":
      for (const v of type.variants) for (const f of v.fields) yield* modelRefs(f.type);
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
    case "actions":
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
      // A field's declared `default` (§7) wins over the kind default — it
      // doubles as the migration `set_default` value.
      for (const f of type.fields)
        obj[f.name] = f.default !== undefined ? f.default : defaultValueForModelType(f.type, models, visited);
      return obj;
    }
    case "model": {
      if (visited.has(type.ref)) return {};
      const model = models.find((m) => m.id === type.ref);
      if (!model) return {};
      const next = new Set(visited).add(type.ref);
      return defaultValueForModelType({ kind: "object", fields: model.fields }, models, next);
    }
    case "map":
      return {};
    case "enum":
      return type.values[0] ?? "";
    case "union": {
      const first = type.variants[0];
      if (!first) return {};
      const obj: Record<string, unknown> = { [type.tag]: first.name };
      for (const f of first.fields)
        obj[f.name] = f.default !== undefined ? f.default : defaultValueForModelType(f.type, models, visited);
      return obj;
    }
    // The wire-shaped Condition[] the core engine evaluates — empty chain.
    case "conditions":
      return [];
    // A Document id, none chosen yet.
    case "document_ref":
      return "";
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
    case "actions":
    case "document_ref":
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
    case "conditions":
      return { kind: "list", of: { kind: "object", fields: [] } };
    // Legacy inferred vocabulary has no map/enum/union — project pragmatically:
    // enum interpolates as a string; a map's keys are unknown at design time;
    // a union exposes its tag plus the union of all variants' fields (the
    // placeholder catalog stays useful without variant narrowing).
    case "enum":
      return { kind: "string" };
    case "map":
      return { kind: "object", fields: [] };
    case "union": {
      const seen = new Set<string>();
      const fields: { name: string; type: FieldType }[] = [
        { name: type.tag, type: { kind: "string" } },
      ];
      for (const v of type.variants) {
        for (const f of v.fields) {
          if (seen.has(f.name)) continue;
          seen.add(f.name);
          fields.push({ name: f.name, type: modelFieldTypeToFieldType(f.type, models, visited) });
        }
      }
      return { kind: "object", fields };
    }
  }
}

/** Legacy `FieldType` of a source: table → list of its model's shape; config → object. */
export function sourceFieldType(project: Project, ds: DataSource): FieldType {
  const models = project.dataModels ?? [];
  if (ds.shape === "table") {
    return {
      kind: "list",
      of: modelFieldTypeToFieldType({ kind: "model", ref: ds.modelId }, models),
    };
  }
  return modelFieldTypeToFieldType({ kind: "object", fields: ds.fields }, models);
}

/** `FieldType` of a table source (list of object). See {@link sourceFieldType}. */
export function tableRowType(project: Project, ds: DataSource & { shape: "table" }): FieldType {
  return sourceFieldType(project, ds);
}

/**
 * Is a Data model still referenced by anything in the project — a table source's
 * `modelId`, a config source's fields, or another model's fields? Used by the
 * delete guard and by auto-model GC when its table is removed.
 */
export function isDataModelReferenced(
  project: Project,
  id: DataModelId,
  ignoreSourceId?: DataSource["id"],
): boolean {
  const refsInFields = (fields: DataModel["fields"]): boolean =>
    fields.some((f) => [...modelRefs(f.type)].includes(id));
  for (const ds of project.dataSources ?? []) {
    if (ds.id === ignoreSourceId) continue;
    if (ds.shape === "table" && ds.modelId === id) return true;
    if (ds.shape === "config" && refsInFields(ds.fields)) return true;
  }
  for (const m of project.dataModels ?? []) {
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
export function sourceRootFields(project: Project, ds: DataSource): ModelField[] {
  if (ds.shape === "table") {
    return (project.dataModels ?? []).find((m) => m.id === ds.modelId)?.fields ?? [];
  }
  return ds.fields;
}

/**
 * Declared type at a value path within a source's row (or config value).
 * String segments name object/model fields; numeric segments index lists.
 */
export function sourceTypeAtPath(
  project: Project,
  ds: DataSource,
  path: (string | number)[],
): ModelFieldType | undefined {
  const models = project.dataModels ?? [];
  let type: ModelFieldType = { kind: "object", fields: sourceRootFields(project, ds) };
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
    } else if (type.kind === "map") {
      // Any string segment keys into the map's value type.
      type = type.of;
    } else if (type.kind === "union") {
      // Variant-blind: the tag is a string; a field name resolves through the
      // first variant declaring it (callers editing values know the active
      // variant, but the path alone doesn't carry it).
      if (seg === type.tag) return { kind: "string" };
      const vf: ModelField | undefined = type.variants
        .flatMap((v) => v.fields)
        .find((x) => x.name === seg);
      if (!vf) return undefined;
      type = vf.type;
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
export function normalizeDataSources(project: Project): void {
  project.dataSources = (project.dataSources ?? []).filter(
    (d) => (d as { shape?: string }).shape === "table" || (d as { shape?: string }).shape === "config",
  );
  if (!project.dataModels) project.dataModels = [];
}

// Field edits: schema change + synchronous value migration.
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
  project: Project,
  value: unknown,
  type: ModelFieldType,
  visited: Set<DataModelId> = new Set(),
): void {
  switch (type.kind) {
    case "ltext":
      if (isLTextNode(value)) deleteLText(project, value);
      return;
    case "list":
      if (Array.isArray(value)) for (const el of value) releaseValueLTexts(project, el, type.of, visited);
      return;
    case "object":
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        for (const f of type.fields) releaseValueLTexts(project, obj[f.name], f.type, visited);
      }
      return;
    case "model": {
      if (visited.has(type.ref)) return;
      const model = (project.dataModels ?? []).find((m) => m.id === type.ref);
      if (!model) return;
      const next = new Set(visited).add(type.ref);
      releaseValueLTexts(project, value, { kind: "object", fields: model.fields }, next);
      return;
    }
    case "map":
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const v of Object.values(value as Record<string, unknown>)) {
          releaseValueLTexts(project, v, type.of, visited);
        }
      }
      return;
    case "union": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      const obj = value as Record<string, unknown>;
      const variant = type.variants.find((v) => v.name === obj[type.tag]);
      if (variant) releaseValueLTexts(project, value, { kind: "object", fields: variant.fields }, visited);
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
  "actions",
]);

/** Best-effort scalar coercion for retype; falls back to the new default. */
function coerceForRetype(
  project: Project,
  value: unknown,
  oldType: ModelFieldType,
  newType: ModelFieldType,
): unknown {
  const models = project.dataModels ?? [];
  if (oldType.kind === newType.kind) return value;
  if (oldType.kind === "ltext" && STRING_LIKE_KINDS.has(newType.kind)) {
    const s = isLTextNode(value) ? getText(project, value, project.defaultLang) : "";
    if (isLTextNode(value)) deleteLText(project, value);
    return s;
  }
  if (newType.kind === "ltext" && STRING_LIKE_KINDS.has(oldType.kind)) {
    return createLText(project, typeof value === "string" ? value : "", project.defaultLang);
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
  releaseValueLTexts(project, value, oldType);
  return defaultValueForModelType(newType, models);
}

/** Apply the value half of an edit to one instance object of the edited list. */
function migrateInstance(project: Project, instance: unknown, edit: FieldEdit): void {
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
  const models = project.dataModels ?? [];
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
  project: Project,
  instance: unknown,
  edit: FieldEdit,
  oldFieldType: ModelFieldType | undefined,
): void {
  if (edit.op === "add" || edit.op === "rename") {
    migrateInstance(project, instance, edit);
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
      if (oldFieldType) releaseValueLTexts(project, obj[edit.name], oldFieldType);
      delete obj[edit.name];
    } else if (edit.op === "retype") {
      if (oldFieldType)
        obj[edit.name] = coerceForRetype(project, obj[edit.name], oldFieldType, edit.newType);
    }
  }
}

/**
 * Visit every value instance governed by `modelId` across the project — table
 * rows of that model plus every nested occurrence reached through model refs
 * in the declared types of other sources. Cycle-defensive.
 */
function forEachModelInstance(
  project: Project,
  modelId: DataModelId,
  visit: (instance: unknown) => void,
): void {
  const models = project.dataModels ?? [];
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
      case "map":
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          for (const v of Object.values(value as Record<string, unknown>)) walk(type.of, v, visited);
        }
        return;
      case "union": {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return;
        const obj = value as Record<string, unknown>;
        const variant = type.variants.find((v) => v.name === obj[type.tag]);
        if (variant) walk({ kind: "object", fields: variant.fields }, value, visited);
        return;
      }
      default:
        return;
    }
  };
  for (const ds of project.dataSources ?? []) {
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
export function applyFieldEdit(project: Project, target: FieldEditTarget, edit: FieldEdit): void {
  const ownerFields =
    target.kind === "model"
      ? (project.dataModels ?? []).find((m) => m.id === target.modelId)?.fields
      : (() => {
          const ds = (project.dataSources ?? []).find((d) => d.id === target.sourceId);
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
    forEachModelInstance(project, target.modelId, (instance) =>
      migrateInstanceTyped(project, instance, edit, oldFieldType),
    );
  } else {
    const ds = (project.dataSources ?? []).find((d) => d.id === target.sourceId);
    if (ds?.shape === "config") migrateInstanceTyped(project, ds.value, edit, oldFieldType);
  }
  applyEditToFields(ownerFields, edit);
}

// Module-declared models (ADR composable-data-models §4/§5)

/** model/v1 document (as reported at Presence) → DataModel, provenance "module". */
export function declaredModelToDomain(doc: Record<string, unknown>): DataModel | null {
  const id = typeof doc.id === "string" ? doc.id : "";
  if (!id.includes(":")) return null;
  return {
    id: id as DataModelId,
    name: typeof doc.name === "string" ? doc.name : id,
    keyField: typeof doc.key_field === "string" ? doc.key_field : "id",
    fields: Array.isArray(doc.fields) ? (doc.fields as ModelField[]) : [],
    provenance: "module",
    ...(typeof doc.version === "number" ? { version: doc.version } : {}),
    ...(Array.isArray(doc.migrations) ? { migrations: doc.migrations as ModelMigration[] } : {}),
    ...(doc.master_detail === true ? { masterDetail: true } : {}),
  };
}

/**
 * Inject the server's declared models into a loaded project (replacing stale
 * copies of the same id) and run pending declarative migrations on every
 * table whose `modelVersion` lags its declaration. Mutates `project`; returns
 * whether any migration ran (the caller persists on the next save).
 */
export function injectDeclaredModels(
  project: Project,
  docs: Record<string, unknown>[],
): boolean {
  const declared = docs
    .map(declaredModelToDomain)
    .filter((m): m is DataModel => m !== null);
  if (declared.length === 0 && !(project.dataModels ?? []).some((m) => m.provenance === "module")) {
    return false;
  }
  const declaredIds = new Set(declared.map((m) => m.id));
  project.dataModels = [
    ...(project.dataModels ?? []).filter((m) => !declaredIds.has(m.id) && m.provenance !== "module"),
    ...declared,
  ];
  let migrated = false;
  for (const ds of project.dataSources ?? []) {
    // A Config typed by a declared model carries only the ref on disk (ADR
    // yaml-assisted-editing) — fill its fields from the declaration, then
    // adopt its bare literals like any row.
    if (ds.shape === "config") {
      const model = ds.modelId ? declared.find((m) => m.id === ds.modelId) : undefined;
      if (!model || ds.fields.length > 0) continue;
      ds.fields = model.fields;
      adoptBareLTexts(project, ds);
      continue;
    }
    if (ds.shape !== "table") continue;
    const model = declared.find((m) => m.id === ds.modelId);
    if (!model) continue;
    // BARE rows were imported untyped (the declaration wasn't known yet) —
    // adopt their literal strings into LText nodes now that the model is
    // (ADR bare-data-files ④). Idempotent on already-typed rows.
    adoptBareLTexts(project, ds);
    if (model.version === undefined || !model.migrations) continue;
    const from = ds.modelVersion ?? 1;
    if (from >= model.version) continue;
    const { applied, toVersion } = applyModelMigrations(ds.rows, from, model.migrations);
    if (applied) {
      ds.modelVersion = toVersion;
      migrated = true;
    }
  }
  return migrated;
}
