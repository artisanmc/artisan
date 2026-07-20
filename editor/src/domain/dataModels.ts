import type {
  DataModel,
  DataModelId,
  DataSource,
  FieldType,
  ModelFieldType,
  Project,
} from "./types";

/**
 * Helpers over {@link DataModel} / Project sources. Cf. ADR
 * `project-sources-and-data-models` + CONTEXT.md "Data model".
 */

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
