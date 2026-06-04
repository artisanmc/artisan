import type { Condition, IfCase, Menu, Step } from "@/domain/types";
import { ActionsChainEditor } from "./ActionsChainEditor";

interface Props {
  step: Extract<Step, { kind: "if" }>;
  packMenus: Menu[];
  onChange: (next: Step) => void;
}

export function IfBlock({ step, packMenus, onChange }: Props) {
  const updateCase = (i: number, next: IfCase) => {
    const cases = step.cases.slice();
    cases[i] = next;
    onChange({ ...step, cases });
  };

  const updateElse = (nextSteps: Step[]) => onChange({ ...step, else: nextSteps });

  return (
    <div className="flex flex-col gap-1">
      {step.cases.map((c, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="text-[11px] font-mono text-[var(--text-mut)]">
            {i === 0 ? "IF" : "ELSE IF"} {summarizeConditions(c.conditions, c.joins)}
          </div>
          <div className="ml-4 border-l border-[var(--border-soft)] pl-3">
            <ActionsChainEditor
              steps={c.steps}
              packMenus={packMenus}
              onChange={(nextSteps) => updateCase(i, { ...c, steps: nextSteps })}
            />
          </div>
        </div>
      ))}
      {step.else !== undefined && (
        <>
          <div className="text-[11px] font-mono text-[var(--text-mut)]">ELSE</div>
          <div className="ml-4 border-l border-[var(--border-soft)] pl-3">
            <ActionsChainEditor
              steps={step.else}
              packMenus={packMenus}
              onChange={updateElse}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Produce a one-line text summary of a condition array.
 * Used in the IF/ELSE IF header.
 */
function summarizeConditions(
  conditions: Condition[],
  joins?: ("and" | "or")[]
): string {
  if (conditions.length === 0) return "(always)";

  const parts = conditions.map(summarizeCondition);
  return parts
    .map((part, i) => {
      if (i === 0) return part;
      const op = joins?.[i - 1] ?? "and";
      return `${op.toUpperCase()} ${part}`;
    })
    .join(" ");
}

function summarizeCondition(c: Condition): string {
  switch (c.type) {
    case "expression":
      return c.expr;
    case "has_permission":
      return `has_permission(${c.perm})`;
    case "has_money":
      return `has_money(${c.amount})`;
    case "placeholder_equals":
      return `${c.placeholder} == ${c.value}`;
    case "placeholder_match":
      return `${c.placeholder} ~ ${c.regex}`;
    case "not":
      return `NOT ${summarizeCondition(c.of)}`;
    case "and":
      return `(${c.of.map(summarizeCondition).join(" AND ")})`;
    case "or":
      return `(${c.of.map(summarizeCondition).join(" OR ")})`;
    default:
      return "(condition)";
  }
}
