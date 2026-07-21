import type { Step } from "@/domain/types";
import { parseToSteps, printFromSteps } from "@/lib/actionDsl";

/**
 * Module-data steps (`actions` field kit widget) — the "wire" for a module-data
 * `actions` field is now the **Action DSL string** (cf. ADR `action-dsl`,
 * Phase 2), not the old structured `[{kind:"action",...}]` tree. Text is
 * LITERAL: no i18n keys, no LText allocation — a quoted literal maps to the
 * LText `key` (the `@/lib/actionDsl` data-source `@`-convention), so the whole
 * domain Step machinery (editors, condition types) stays reusable.
 *
 * `stepsToWire` prints the canonical DSL string; `stepsFromWire` parses it back.
 * A missing / empty / non-string value → `[]`. The function names are kept: the
 * caller (SchemaForm `actions` widget) still speaks "wire", only the shape
 * changed from array to string.
 */

/** Domain steps → wire value (canonical Action DSL string, literal text). */
export function stepsToWire(steps: Step[]): string {
  return printFromSteps(steps);
}

/** Wire value (Action DSL string) → domain steps. Non-string / empty / unparseable → []. */
export function stepsFromWire(raw: unknown): Step[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    return parseToSteps(raw);
  } catch {
    return [];
  }
}
