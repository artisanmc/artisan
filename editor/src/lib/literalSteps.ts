import type { I18nKey, Step } from "@/domain/types";
import { parseToSteps } from "@/lib/actionDsl";
import {
  stepsToStructured,
  structuredToSteps,
  type ActionTextCodec,
} from "@/lib/actions/structuredSteps";

/**
 * Wire for the action chains of a data source **`actions`** field (and of the
 * module-data widget). Since ADR `structured-action-wire` the value is a
 * **tree of keyed steps** (like document click handlers), no longer a DSL
 * string.
 *
 * Text there is **literal**: no i18n keys, the literal lives in the domain's
 * `LText.key`. An old file holding a **DSL string** is still read (and
 * rewritten structured on the next save).
 */

const literalCodec: ActionTextCodec = {
  toWire: (key) => String(key),
  fromWire: (raw) => ({ key: (typeof raw === "string" ? raw : "") as I18nKey }),
};

/** Domain steps → wire value (tree of keyed steps, literal text). */
export function stepsToWire(steps: Step[]): unknown[] {
  return stepsToStructured(steps, literalCodec);
}

/** Wire value (arbre keyed, ou string DSL legacy) → domain steps. */
export function stepsFromWire(raw: unknown): Step[] {
  if (typeof raw === "string") {
    if (raw.trim() === "") return [];
    try {
      return parseToSteps(raw);
    } catch {
      return [];
    }
  }
  return structuredToSteps(raw, literalCodec);
}
