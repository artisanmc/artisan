import { projectNamespace } from "@/domain/docRef";
import type { DataSource, ModelField, Project } from "@/domain/types";

/** One line of a settings screen's preview: a field's label and its value, as read. */
export interface PreviewLine {
  label: string;
  /** The value as text; a boolean stays a boolean so the view can say it in the UI's language. */
  value: string | number | boolean;
  /** A list or a map: `value` is how many entries it holds. */
  count?: true;
}

/** At most this many lines: the home gives an idea of a screen, the screen shows it all. */
export const PREVIEW_LINES = 4;

/**
 * What a module's settings screen holds, read from the Project's own copy of the file it
 * edits (`data/<id>`): its first plain values (text, number, choice, switch) and how many
 * entries its lists and maps hold, in the order the model declares them. Items, actions,
 * nested objects say nothing at a glance and are left out. A table says how many rows it
 * has. Empty when the file is not in the Project (a screen of another folder, a file not
 * written yet): the row then shows the screen's name alone.
 *
 * The labels are the model's: the one the file names, else the declared model with the
 * screen's id (a module names both alike, `daily:settings`). A file with no model known
 * shows its keys, written as words (`reset_time` → "Reset time").
 */
export function screenPreview(
  project: Pick<Project, "id" | "diskId" | "dataSources" | "dataModels">,
  screen: { id: string; projectId: string; table: string },
): { lines: PreviewLine[]; rows?: number } {
  if (screen.projectId !== projectNamespace(project)) return { lines: [] };
  const id = screen.table.replace(/^data\//, "");
  const source = (project.dataSources ?? []).find((d) => String(d.id) === id);
  if (!source) return { lines: [] };
  if (source.shape === "table") return { lines: [], rows: source.rows.length };
  const lines: PreviewLine[] = [];
  for (const field of fieldsOf(project, source, screen.id)) {
    if (lines.length >= PREVIEW_LINES) break;
    const line = lineOf(field, source.value[field.name]);
    if (line) lines.push(line);
  }
  return { lines };
}

function fieldsOf(
  project: Pick<Project, "dataModels">,
  source: DataSource & { shape: "config" },
  screenId: string,
): ModelField[] {
  if (source.fields.length > 0) return source.fields;
  const models = project.dataModels ?? [];
  const model =
    (source.modelId && models.find((m) => m.id === source.modelId)) ||
    models.find((m) => m.id === screenId);
  if (model && model.fields.length > 0) return model.fields;
  return Object.entries(source.value ?? {}).map(([name, v]) => ({
    name,
    label: words(name),
    type: literalKind(v),
  }));
}

/** `reset_time` → "Reset time". */
function words(key: string): string {
  const text = key.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a stored value is, for a file without a model: enough to preview it. */
function literalKind(v: unknown): ModelField["type"] {
  if (typeof v === "number") return { kind: "number" };
  if (typeof v === "boolean") return { kind: "boolean" };
  if (typeof v === "string") return { kind: "string" };
  if (Array.isArray(v)) return { kind: "list", of: { kind: "string" } };
  // Entries keyed by number (days, levels): a map, worth counting. Any other object is
  // one value of many fields, which a line cannot say.
  if (
    v &&
    typeof v === "object" &&
    Object.keys(v).length > 0 &&
    Object.keys(v).every((k) => /^\d+$/.test(k))
  )
    return { kind: "map", of: { kind: "string" } };
  return { kind: "item" };
}

function lineOf(field: ModelField, raw: unknown): PreviewLine | null {
  const label = field.label?.trim() || field.name;
  const value = raw ?? field.default;
  switch (field.type.kind) {
    case "string":
    case "enum":
      return typeof value === "string" && value !== "" ? { label, value } : null;
    case "number":
    case "integer":
      return typeof value === "number" ? { label, value } : null;
    case "boolean":
      return typeof value === "boolean" ? { label, value } : null;
    case "list":
      return { label, value: Array.isArray(value) ? value.length : 0, count: true };
    case "map":
      return {
        label,
        value: value && typeof value === "object" ? Object.keys(value).length : 0,
        count: true,
      };
    default:
      return null;
  }
}
