// Comments a data file carries from its model's presentation hints (ADR
// `yaml-assisted-editing` ⑥): regenerated at every write, ignored at import.
import type { DataSource, ModelField, ModelFieldType } from "@/domain/types";
import { Document as YamlDocument, isMap, isScalar, isSeq } from "yaml";

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
  plainIndexKeys(doc.contents);
  annotate(doc.contents, fields);
  return doc.toString(yamlOpts);
}

/**
 * A mapping keyed by numbers (guild levels `0:`, `1:`…) is written with plain
 * keys, as the add-ons' own defaults are. In memory those keys are strings,
 * which the writer would otherwise quote (`"0":`) on every save. Only when
 * every key of the mapping is a number: a mixed mapping keeps its keys as they are.
 */
function plainIndexKeys(node: unknown): void {
  if (isSeq(node)) {
    for (const item of node.items) plainIndexKeys(item);
    return;
  }
  if (!isMap(node)) return;
  const indexKeys =
    node.items.length > 0 &&
    node.items.every(
      (p) =>
        isScalar(p.key) && typeof p.key.value === "string" && /^(0|[1-9]\d{0,8})$/.test(p.key.value),
    );
  for (const pair of node.items) {
    if (indexKeys && isScalar(pair.key)) pair.key.value = Number(pair.key.value);
    plainIndexKeys(pair.value);
  }
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
