import type { I18nKey, Step } from "@/domain/types";
import { parseToSteps } from "@/lib/actionDsl";
import {
  stepsToStructured,
  structuredToSteps,
  type ActionTextCodec,
} from "@/lib/actions/structuredSteps";

/**
 * Wire des chaînes d'actions d'un champ **`actions`** de data source (et du
 * widget module-data). Depuis l'ADR `structured-action-wire` la valeur est un
 * **arbre de steps keyed** (comme les click-handlers de document), plus une
 * string DSL.
 *
 * Le texte y est **littéral** : pas de clés i18n, le littéral vit dans le
 * `LText.key` du domaine. Un ancien fichier portant une **string DSL** reste lu
 * (et ré-écrit structuré au prochain save).
 */

const literalCodec: ActionTextCodec = {
  toWire: (key) => String(key),
  fromWire: (raw) => ({ key: (typeof raw === "string" ? raw : "") as I18nKey }),
};

/** Domain steps → wire value (arbre de steps keyed, texte littéral). */
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
