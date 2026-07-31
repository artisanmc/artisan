import type { DataSource, ModelFieldType, Project } from "./types";

type TableSource = Extract<DataSource, { shape: "table" }>;
type RowKeyKind = "string" | "number" | "integer";

export type SourceRowKeyValidation =
  | { ok: true; value: string | number }
  | { ok: false; reason: "required" | "duplicate" };

function rowKeyKind(project: Project, source: TableSource): { field: string; kind: RowKeyKind } {
  const model = project.dataModels?.find(({ id }) => id === source.modelId);
  if (!model) {
    throw new Error(`Data source ${source.id} references a missing data model.`);
  }

  const field = model.fields.find(({ name }) => name === model.keyField);
  if (!field) {
    throw new Error(`Data model ${model.id} is missing its key field ${model.keyField}.`);
  }
  if (!isRowKeyKind(field.type)) {
    throw new Error(`Data model ${model.id} key field ${field.name} has an unsupported type.`);
  }
  return { field: field.name, kind: field.type.kind };
}

function isRowKeyKind(type: ModelFieldType): type is Extract<ModelFieldType, { kind: RowKeyKind }> {
  return type.kind === "string" || type.kind === "number" || type.kind === "integer";
}

function normalizeString(value: unknown): string {
  return (value == null ? "" : String(value)).trim().toLowerCase();
}

function normalizeNumeric(value: unknown, kind: "number" | "integer"): number | undefined {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return kind === "integer" ? Math.round(numeric) : numeric;
}

export function validateSourceRowKey(
  project: Project,
  source: TableSource,
  rowIndex: number,
  candidate: unknown,
): SourceRowKeyValidation {
  const { field, kind } = rowKeyKind(project, source);
  const value = kind === "string"
    ? normalizeString(candidate)
    : normalizeNumeric(candidate, kind);

  if (value === "" || value === undefined) {
    return { ok: false, reason: "required" };
  }

  const duplicate = source.rows.some((row, index) => {
    if (index === rowIndex) {
      return false;
    }
    const existing = kind === "string"
      ? normalizeString(row[field])
      : normalizeNumeric(row[field], kind);
    return existing === value;
  });

  return duplicate ? { ok: false, reason: "duplicate" } : { ok: true, value };
}

export function nextAvailableSourceRowKey(project: Project, source: TableSource): string | number {
  const { kind } = rowKeyKind(project, source);
  for (let index = 1; ; index += 1) {
    const candidate = kind === "string" ? `row_${index}` : index;
    if (validateSourceRowKey(project, source, -1, candidate).ok) {
      return candidate;
    }
  }
}
