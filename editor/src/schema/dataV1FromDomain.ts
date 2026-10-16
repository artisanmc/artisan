// Domain → `data/` + `models/` writer (ADR `bare-data-files`): the inverse of
// the data-source half of `projectFromFiles.ts`.
//
// Denormalized per ADR project-sources-and-data-models: Data models are inlined
// as flattened field kinds — the plugin never sees model identity (same
// philosophy as Item templates inlined into menu/v1). ltext values export as
// the default language's literal (other languages travel in lang/); item values
// as refs (stacks travel in items/); minimessage fields export as plain strings.
import { visitDataSourceLTexts } from "@/domain/i18nSites";
import type {
  Condition,
  DataModel,
  DataModelId,
  ModelField,
  ModelFieldType,
  Project,
} from "@/domain/types";
import { stringify } from "yaml";
import { dataFileHeader, stringifyWithHints } from "./yamlHints";

type YamlOpts = { lineWidth: number };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Most conditions are stored snake_case and contain no LText — pass through
// as-is. Exceptions: composites (recursive) and pagination (camelCase domain).
function serializeCondition(c: Condition): unknown {
  if (c.type === "not") return { type: "not", of: serializeCondition(c.of) };
  if (c.type === "and") return { type: "and", of: c.of.map(serializeCondition) };
  if (c.type === "or") return { type: "or", of: c.of.map(serializeCondition) };
  if (c.type === "pagination_at_first" || c.type === "pagination_at_last") {
    return { type: c.type, ...(c.elementId ? { element_id: c.elementId } : {}) };
  }
  return c;
}

function serializeDataFieldType(
  type: ModelFieldType,
  models: DataModel[],
  visited: Set<DataModelId>,
): Record<string, unknown> {
  switch (type.kind) {
    case "list":
      return { kind: "list", of: serializeDataFieldType(type.of, models, visited) };
    // minimessage is an editor-only editing affordance — the stored value is
    // a plain string, so data/v1 (and the plugin) only ever sees `string`.
    case "minimessage":
    case "minimessage_multiline":
      return { kind: "string" };
    // actions keep their own kind: the value is an Action DSL string the plugin
    // will parse+execute (Action chain). Cf. ADR `action-dsl`.
    case "actions":
      return { kind: "actions" };
    case "object":
      return {
        kind: "object",
        fields: type.fields.map((f) => serializeDataField(f, models, visited)),
      };
    case "model": {
      const model = visited.has(type.ref) ? undefined : models.find((m) => m.id === type.ref);
      if (!model) return { kind: "object", fields: [] };
      const next = new Set(visited).add(type.ref);
      return {
        kind: "object",
        fields: model.fields.map((f) => serializeDataField(f, models, next)),
      };
    }
    // Composable kinds (ADR composable-data-models) — denormalized INLINE so
    // the data file stays self-contained for the model-blind runtime.
    case "map":
      return { kind: "map", of: serializeDataFieldType(type.of, models, visited) };
    case "enum":
      return { kind: "enum", values: type.values };
    case "union":
      return {
        kind: "union",
        tag: type.tag,
        variants: type.variants.map((v) => ({
          name: v.name,
          fields: v.fields.map((f) => serializeDataField(f, models, visited)),
        })),
      };
    default:
      return { kind: type.kind };
  }
}

function serializeDataField(
  field: ModelField,
  models: DataModel[],
  visited: Set<DataModelId>,
): Record<string, unknown> {
  return { name: field.name, ...serializeDataFieldType(field.type, models, visited) };
}

/** ltext inlining context (ADR bare-data-files ④): a value serializes as the
 *  DEFAULT language's literal text; other languages travel in lang/ under the
 *  canonical key-site address. */
interface DataI18nCtx {
  defaultLang: string;
  keys: Readonly<Record<string, Record<string, string> | undefined>>;
}

function serializeDataValue(
  value: unknown,
  type: ModelFieldType,
  models: DataModel[],
  visited: Set<DataModelId>,
  i18n: DataI18nCtx,
): unknown {
  switch (type.kind) {
    case "item": {
      const map = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(map);
        if (v && typeof v === "object") {
          if ("key" in v) return i18n.keys[String(v.key)]?.[i18n.defaultLang] ?? "";
          return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]));
        }
        return v;
      };
      return map(value);
    }
    case "ltext": {
      if (typeof value !== "object" || value === null || !("key" in value)) return "";
      return i18n.keys[String(value.key)]?.[i18n.defaultLang] ?? "";
    }
    case "list":
      return Array.isArray(value)
        ? value.map((el) => serializeDataValue(el, type.of, models, visited, i18n))
        : [];
    case "object": {
      const obj = isRecord(value) ? value : {};
      const out: Record<string, unknown> = {};
      for (const f of type.fields)
        out[f.name] = serializeDataValue(obj[f.name], f.type, models, visited, i18n);
      return out;
    }
    case "model": {
      const model = visited.has(type.ref) ? undefined : models.find((m) => m.id === type.ref);
      if (!model) return {};
      const next = new Set(visited).add(type.ref);
      return serializeDataValue(
        value,
        { kind: "object", fields: model.fields },
        models,
        next,
        i18n,
      );
    }
    case "map": {
      const obj = isRecord(value) ? value : {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj))
        out[k] = serializeDataValue(v, type.of, models, visited, i18n);
      return out;
    }
    // enum values are plain strings — closedness is enforced at edit time only
    // (non-hermetic contract).
    case "enum":
      return value;
    // Core condition vocabulary (§6): serialize through the single condition
    // codec so composites and camelCase domain fields hit the wire shape.
    // The value is typed by the field kind, not checked: untyped at this layer.
    case "conditions":
      return Array.isArray(value) ? (value as Condition[]).map(serializeCondition) : [];
    case "union": {
      const obj = isRecord(value) ? value : {};
      const tagValue = obj[type.tag];
      const variant = type.variants.find((v) => v.name === tagValue);
      if (!variant) return { [type.tag]: tagValue };
      const out: Record<string, unknown> = { [type.tag]: tagValue };
      for (const f of variant.fields)
        out[f.name] = serializeDataValue(obj[f.name], f.type, models, visited, i18n);
      return out;
    }
    default:
      return value;
  }
}

/** Non-default translations of every data-source ltext site, re-addressed to
 *  the canonical key-site path, plus the set of node keys those sites hold
 *  (excluded from lang/ — the default text is inlined in the data file). */
export function dataSourceI18n(project: Project): {
  nodeKeys: Set<string>;
  byLang: Record<string, Record<string, string>>;
} {
  const nodeKeys = new Set<string>();
  const byLang: Record<string, Record<string, string>> = {};
  for (const ds of project.dataSources ?? []) {
    for (const site of visitDataSourceLTexts(project, ds)) {
      const key = site.lText.key;
      nodeKeys.add(key);
      const entry = project.i18nKeys[key];
      if (!entry) continue;
      for (const [lang, val] of Object.entries(entry)) {
        if (lang === project.defaultLang) continue;
        byLang[lang] ??= {};
        byLang[lang][site.path] = val;
      }
    }
  }
  return { nodeKeys, byLang };
}

/** Model ids referenced by a `model`-kind field anywhere (shared — never
 *  emitted at a source's filename). */
function modelKindRefs(models: DataModel[]): Set<string> {
  const out = new Set<string>();
  const walk = (ty: ModelFieldType): void => {
    switch (ty.kind) {
      case "model":
        out.add(String(ty.ref));
        return;
      case "list":
      case "map":
        walk(ty.of);
        return;
      case "object":
        for (const f of ty.fields) walk(f.type);
        return;
      case "union":
        for (const v of ty.variants) for (const f of v.fields) walk(f.type);
        return;
      default:
        return;
    }
  };
  for (const m of models) for (const f of m.fields) walk(f.type);
  return out;
}

/** The `model/v1` document of a project-authored Data model, fields verbatim. */
export function modelV1FromDomain(m: DataModel): Record<string, unknown> {
  return {
    schema: "model/v1",
    id: m.id,
    name: m.name,
    key_field: m.keyField,
    ...(m.masterDetail ? { master_detail: true } : {}),
    fields: m.fields,
  };
}

/** Row-file name for a per-row Table: the Row key value, slugified; empty or
 *  duplicate keys fall back to `row_<n>` (positional), like i18n row keys. */
export function rowFileName(rows: Record<string, unknown>[], keyField: string, i: number): string {
  const raw = rows[i]?.[keyField];
  const slug =
    typeof raw === "string" || typeof raw === "number"
      ? String(raw)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "_")
      : "";
  if (slug === "" || slug.startsWith("_")) return `row_${i + 1}`;
  const dup = rows.some(
    (r, j) =>
      j !== i &&
      String(r[keyField] ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_") === slug,
  );
  return dup ? `row_${i + 1}` : slug;
}

/**
 * Emit every Project source in the BARE form (ADR bare-data-files): data files
 * are pure values (ltext = default-language literal), the schema lives beside
 * them — models/<sourceId>.yaml (owned model doc, or a one-line `model:` ref)
 * or a minimal per-row `_source.yaml` (`name?`/`model`/`model_version?`/
 * `order`). Returns the model ids whose doc was emitted at a source filename
 * (or intentionally not at all) so the generic models/ loop skips them.
 */
export function emitDataSources(
  project: Project,
  base: string,
  files: Record<string, string>,
  yamlOpts: YamlOpts,
): Set<string> {
  const models = project.dataModels ?? [];
  const i18n: DataI18nCtx = { defaultLang: project.defaultLang, keys: project.i18nKeys };
  const kindRefs = modelKindRefs(models);
  const tableUse = new Map<string, number>();
  for (const ds of project.dataSources ?? []) {
    if (ds.shape === "table")
      tableUse.set(String(ds.modelId), (tableUse.get(String(ds.modelId)) ?? 0) + 1);
  }
  const claimed = new Set<string>();

  for (const ds of project.dataSources ?? []) {
    if (ds.shape === "config") {
      // Schemaless source (bare file, no model beside it): field-driven
      // serialization would drop every key and empty the file. Untyped values
      // travel verbatim (ADR bare-data-files ③).
      const value =
        ds.fields.length === 0
          ? ds.value
          : serializeDataValue(
              ds.value,
              { kind: "object", fields: ds.fields },
              models,
              new Set(),
              i18n,
            );
      files[`${base}/data/${ds.id}.yaml`] =
        dataFileHeader(ds, ds.name, ds.fields) + stringifyWithHints(value, ds.fields, yamlOpts);
      // A module-declared schema lives in the module's JAR and arrives via
      // Presence — the beside file is a one-line ref, never a copy (ADR
      // yaml-assisted-editing). Only a project-authored schema is written out.
      const declaredModel =
        ds.modelId && models.find((m) => m.id === ds.modelId)?.provenance === "module";
      if (declaredModel) {
        files[`${base}/models/${ds.id}.yaml`] = stringify({ model: String(ds.modelId) }, yamlOpts);
        claimed.add(String(ds.id));
      } else if (ds.fields.length > 0) {
        files[`${base}/models/${ds.id}.yaml`] = stringify(
          { schema: "model/v1", id: ds.id, name: ds.name, fields: ds.fields },
          yamlOpts,
        );
        claimed.add(String(ds.id));
      }
      continue;
    }

    const model = models.find((m) => m.id === ds.modelId);
    const fields = model?.fields ?? [];
    // No resolvable schema (a module-declared model the Presence hasn't
    // delivered, a removed module…): the rows are the user's data — emit them
    // verbatim rather than serializing them against an empty field list, which
    // would blank every row.
    const rowsOut =
      fields.length === 0
        ? ds.rows
        : ds.rows.map((r) =>
            serializeDataValue(
              r,
              { kind: "object", fields },
              models,
              new Set(model ? [model.id] : []),
              i18n,
            ),
          );
    const header = dataFileHeader(ds, ds.name, fields);
    // A model owned by this source alone: its doc is written at the source's
    // filename (or, untyped, not at all).
    const owned =
      model !== undefined &&
      model.provenance !== "module" &&
      (tableUse.get(String(model.id)) ?? 0) === 1 &&
      !kindRefs.has(String(model.id))
        ? model
        : undefined;
    const link: Record<string, unknown> = {
      ...(ds.name !== String(ds.id) ? { name: ds.name } : {}),
      model: String(ds.modelId),
      ...(model?.version !== undefined ? { model_version: model.version } : {}),
    };

    if (ds.granularity === "row") {
      const names = ds.rows.map((_, i) => rowFileName(ds.rows, model?.keyField ?? "id", i));
      files[`${base}/data/${ds.id}/_source.yaml`] =
        header + stringify({ ...link, order: names }, yamlOpts);
      rowsOut.forEach((row, i) => {
        // Each row file is a standalone file someone may open over SSH — it
        // carries the schema's hints like any other (ADR yaml-assisted-editing ⑥).
        files[`${base}/data/${ds.id}/${names[i]}.yaml`] = stringifyWithHints(row, fields, yamlOpts);
      });
      if (owned && fields.length > 0) {
        files[`${base}/models/${ds.id}.yaml`] = stringify(modelV1FromDomain(owned), yamlOpts);
        claimed.add(String(owned.id));
      } else if (owned) {
        claimed.add(String(owned.id)); // untyped synthesized — no doc at all
      }
      continue;
    }

    files[`${base}/data/${ds.id}.yaml`] = header + stringify(rowsOut, yamlOpts);
    if (owned && fields.length > 0) {
      files[`${base}/models/${ds.id}.yaml`] = stringify(modelV1FromDomain(owned), yamlOpts);
      claimed.add(String(owned.id));
    } else if (owned) {
      claimed.add(String(owned.id)); // untyped synthesized — no doc at all
    } else {
      // Declared or shared model: one-line(ish) ref beside the data.
      files[`${base}/models/${ds.id}.yaml`] = stringify(link, yamlOpts);
    }
  }
  return claimed;
}
