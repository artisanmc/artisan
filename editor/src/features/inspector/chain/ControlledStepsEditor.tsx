import type { ProjectId, Step } from "@/domain/types";
import { StepTree } from "./StepTree";
import { controlledChainOps } from "./chainOps";

/**
 * CONTROLLED Action chain editor — `value: Step[]` + `onChange`, no store
 * coupling. Powers the `actions` MC field kit widget (module data): text is
 * LITERAL (`literalText` mode of ActionLine/ActionEditor — the raw string
 * lives in LText.key, wire round-trip via `@/lib/literalSteps`). Same
 * `StepTree` as the Element / Command / Dialog chains, with its edits applied
 * to the value (`controlledChainOps`).
 */
export function ControlledStepsEditor({
  projectId,
  value,
  onChange,
}: {
  projectId: ProjectId;
  value: Step[];
  onChange: (steps: Step[]) => void;
}) {
  return (
    <div className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5 font-mono text-[12px]">
      <StepTree
        projectId={projectId}
        ops={controlledChainOps(value, onChange)}
        steps={value}
        frames={[]}
        indent={0}
        literalText
      />
    </div>
  );
}
