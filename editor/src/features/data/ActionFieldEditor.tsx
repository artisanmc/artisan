import type { ProjectId } from "@/domain/types";
import { ControlledStepsEditor } from "@/features/inspector/chain/ControlledStepsEditor";
import { stepsFromWire, stepsToWire } from "@/lib/literalSteps";
import { useMemo } from "react";

/**
 * Value editor for an `actions` field (an Action chain stored as a structured
 * step tree — ADR `structured-action-wire`). Reuses the shared
 * `ControlledStepsEditor` (pseudocode). Text is literal (no i18n keys). An old
 * value written as an Action DSL string is still read, and is re-emitted
 * structured on the next change.
 */
export function ActionFieldEditor({
  projectId,
  value,
  onChange,
}: {
  projectId: ProjectId;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const steps = useMemo(() => stepsFromWire(value), [value]);
  return (
    <div className="flex min-w-64 flex-col gap-1" data-testid="action-field-editor">
      <ControlledStepsEditor
        projectId={projectId}
        value={steps}
        onChange={(next) => onChange(stepsToWire(next))}
      />
    </div>
  );
}
