import type { Condition } from "@/domain/types";
import {
  conditionFromStructured,
  conditionsToStructured,
  isDecodableCondition,
} from "@/lib/actions/structuredSteps";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ConditionListEditor } from "./ConditionListEditor";

export interface ConditionsFieldProps {
  /** An `if:` list in keyed wire (AND); a single condition is read as a list of one. */
  value: unknown;
  onChange: (conditions: unknown[]) => void;
  label?: string;
  emptyHint?: string;
}

/**
 * A condition list stored as a module's Document carries it (the keyed wire
 * `api.getConditions()` reads), edited with the editor's condition list. An entry the editor
 * cannot decode (a module's condition, a type-tagged one) is kept as read, after the edited ones.
 */
export function ConditionsField({ value, onChange, label = "", emptyHint }: ConditionsFieldProps) {
  const { t } = useTranslation();
  const { conditions, kept } = useMemo(() => {
    const list = Array.isArray(value) ? value : value == null ? [] : [value];
    const conditions: Condition[] = [];
    const kept: unknown[] = [];
    for (const raw of list) {
      const decoded = isDecodableCondition(raw) ? conditionFromStructured(raw) : null;
      if (decoded) conditions.push(decoded);
      else kept.push(raw);
    }
    return { conditions, kept };
  }, [value]);
  return (
    <div className="flex flex-col gap-1">
      <ConditionListEditor
        label={label}
        conditions={conditions}
        onChange={(next) => onChange([...conditionsToStructured(next), ...kept])}
        emptyHint={emptyHint}
      />
      {kept.length > 0 ? (
        <p className="text-[11.5px] text-[var(--text-faint)]">
          {t("conditions.keptUnknown", { count: kept.length })}
        </p>
      ) : null}
    </div>
  );
}
