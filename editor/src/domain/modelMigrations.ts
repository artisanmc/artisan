// Declarative model migrations (ADR composable-data-models §5).
//
// A module-declared Data model carries a monotonic `version`; its declaration
// ships migration steps — a CLOSED vocabulary of data transforms (never code,
// so a third-party declaration stays pure data). The editor applies them at
// load to instances written under an older version; the result materializes at
// the next save. Anything the vocabulary can't express simply doesn't apply —
// the affected values dangle visibly in the form (non-hermetic contract).
// The runtime is never involved: data files carry their schema inline.

export type MigrationStep =
  | { op: "rename_field"; from: string; to: string; path?: string[] }
  | { op: "set_default"; field: string; value: unknown; path?: string[] }
  | { op: "rename_enum_value"; field: string; from: string; to: string; path?: string[] }
  | {
      op: "rename_variant";
      field: string;
      tag?: string;
      from: string;
      to: string;
      path?: string[];
    };

export interface ModelMigration {
  from: number;
  to: number;
  steps: MigrationStep[];
}

/**
 * Every object reachable at `path` from `root`: string segments name object
 * fields; lists and maps fan out over their elements/values (the engine is
 * model-blind — collections are walked structurally).
 */
function targetsAt(root: unknown, path: string[] | undefined): Record<string, unknown>[] {
  let current: unknown[] = [root];
  for (const seg of path ?? []) {
    const next: unknown[] = [];
    for (const t of current) {
      if (typeof t !== "object" || t === null) continue;
      if (Array.isArray(t)) {
        // A list segment shouldn't happen (paths name fields), but fan out
        // defensively so `a.b` still reaches `a[*].b`.
        for (const el of t) next.push(el);
        continue;
      }
      const v = (t as Record<string, unknown>)[seg];
      if (Array.isArray(v)) next.push(...v);
      else if (typeof v === "object" && v !== null) {
        // Could be the named object OR a map whose values are the targets —
        // undecidable structurally; push the object itself, and its object
        // values (map fan-out). Steps are name-guarded, so a wrong candidate
        // is a no-op.
        next.push(v);
        for (const mv of Object.values(v as Record<string, unknown>)) {
          if (typeof mv === "object" && mv !== null && !Array.isArray(mv)) next.push(mv);
        }
      }
    }
    current = next;
  }
  return current.filter(
    (t): t is Record<string, unknown> => typeof t === "object" && t !== null && !Array.isArray(t),
  );
}

function applyStep(instance: Record<string, unknown>, step: MigrationStep): void {
  switch (step.op) {
    case "rename_field":
      for (const t of targetsAt(instance, step.path)) {
        if (step.from in t && !(step.to in t)) {
          t[step.to] = t[step.from];
          delete t[step.from];
        }
      }
      return;
    case "set_default":
      for (const t of targetsAt(instance, step.path)) {
        if (!(step.field in t) || t[step.field] === undefined) t[step.field] = step.value;
      }
      return;
    case "rename_enum_value":
      for (const t of targetsAt(instance, step.path)) {
        if (t[step.field] === step.from) t[step.field] = step.to;
      }
      return;
    case "rename_variant": {
      const tag = step.tag ?? "type";
      for (const t of targetsAt(instance, step.path)) {
        const v = t[step.field];
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          const obj = v as Record<string, unknown>;
          if (obj[tag] === step.from) obj[tag] = step.to;
        }
      }
      return;
    }
    default:
      // Unknown op (newer declaration than this editor): skip — the values
      // dangle rather than crash (forward-compat).
      return;
  }
}

/**
 * Apply the migration chain to instances written at `fromVersion`, in order.
 * The chain must be contiguous from `fromVersion` (a gap stops before it —
 * nothing half-applies). Mutates instances in place; returns whether anything
 * ran and the version reached.
 */
export function applyModelMigrations(
  instances: Record<string, unknown>[],
  fromVersion: number,
  migrations: ModelMigration[],
): { applied: boolean; toVersion: number } {
  const chain = [...migrations].sort((a, b) => a.from - b.from);
  let version = fromVersion;
  let applied = false;
  for (const m of chain) {
    if (m.from !== version) continue;
    for (const instance of instances) {
      for (const step of m.steps) applyStep(instance, step);
    }
    version = m.to;
    applied = true;
  }
  return { applied, toVersion: version };
}
