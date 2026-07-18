import type { I18nKey, LText, Step } from "@/domain/types";
import { serializeStepsLiteral } from "@/features/export/transform";
import { makeStepConverter } from "@/schema/actionV1ToDomain";

/**
 * Module-data steps (`actions` field kit widget) — same wire structure as the
 * exported menu step trees, but text is LITERAL: no i18n keys, no LText
 * allocation. In memory the literal string lives in the LText `key` (so the
 * whole domain Step machinery — editors, condition types — is reusable);
 * on the wire it is emitted verbatim, which is exactly what the plugin's
 * ActionParser reads (`text: "raw"` with no `{i18n:…}` wrapper).
 */

/** Domain steps → wire steps (literal text). */
export function stepsToWire(steps: Step[]): unknown[] {
  return serializeStepsLiteral(steps);
}

/** Wire steps → domain steps (literal text wrapped into LText.key). */
export function stepsFromWire(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  const literal = (s: string | undefined): LText => ({ key: (s ?? "") as I18nKey });
  const { step } = makeStepConverter({
    text: literal,
    ref: (key) => ({ key: key as I18nKey }),
    pushUnsupported: () => {},
  });
  return raw.map((s) => step(s as Record<string, unknown>)).filter(Boolean) as Step[];
}
