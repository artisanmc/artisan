// Comments a data file carries from its model's presentation hints (ADR
// `yaml-assisted-editing` ⑥): regenerated at every write, ignored at import.
import type { DataSource, ModelField, ModelFieldType } from "@/domain/types";
import { Document as YamlDocument, isMap, isScalar } from "yaml";

/** Generated header block from the model's presentation hints (⑦): recomputed
 *  at every export, stripped back out at import (marker line `# ──`). */
function generatedHeader(name: string, fields: ModelField[]): string {
  if (!hasAnyHelp(fields)) return "";
  // The hints themselves now sit above the key they document (ADR
  // yaml-assisted-editing ⑥) — the header only says what the file does to
  // comments, because it overwrites them and must not pretend otherwise.
  return `${[
    `# ── ${name} — managed by Artisan (values can be edited by hand)`,
    "# Comments are generated from the schema: a comment added anywhere",
    "# other than the top of the file is overwritten on the next save.",
  ].join("\n")}\n`;
}

function hasAnyHelp(fields: ModelField[]): boolean {
  return fields.some(
    (f) => (typeof f.help === "string" && f.help !== "") || hasAnyHelp(childFields(f.type)),
  );
}

function childFields(type: ModelFieldType): ModelField[] {
  switch (type.kind) {
    case "object":
      return type.fields;
    case "list":
    case "map":
      return childFields(type.of);
    case "union":
      return type.variants.flatMap((v) => v.fields);
    default:
      return [];
  }
}

/**
 * Serialize with each field's `help` as a comment directly above its key, at
 * any depth (ADR yaml-assisted-editing ⑥). Comments carry no data: they are
 * regenerated at every write and ignored at import.
 */
export function stringifyWithHints(
  value: unknown,
  fields: ModelField[],
  yamlOpts: { lineWidth: number },
): string {
  const doc = new YamlDocument(value);
  annotate(doc.contents, fields);
  return doc.toString(yamlOpts);
}

function annotate(node: unknown, fields: ModelField[]): void {
  if (!isMap(node)) return;
  for (const field of fields) {
    const pair = node.items.find((p) => scalarKey(p.key) === field.name);
    if (!pair) continue;
    if (typeof field.help === "string" && field.help !== "" && isScalar(pair.key)) {
      // `commentBefore` renders as `# <text>` above the key, indented with it.
      pair.key.commentBefore = ` ${field.help}`;
    }
    annotate(pair.value, childFields(field.type));
  }
}

function scalarKey(key: unknown): string | null {
  if (isScalar(key)) return String(key.value);
  return typeof key === "string" ? key : null;
}

export function dataFileHeader(ds: DataSource, name: string, fields: ModelField[]): string {
  const hand = ds.headerComment ? `${ds.headerComment}\n` : "";
  return hand + generatedHeader(name, fields);
}
