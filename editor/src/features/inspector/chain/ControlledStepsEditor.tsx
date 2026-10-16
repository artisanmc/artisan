import { menusOf } from "@/domain/documents";
import type { StepFrame } from "@/domain/stepPath";
import { resolveParentMut } from "@/domain/stepPath";
import type { ProjectId, Step } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { produce } from "immer";
import { ActionLine, AddStepLine, IfBlock, SortableStep, useStepIds } from "./PseudocodeView";

/**
 * CONTROLLED pseudocode step editor — `value: Step[]` + `onChange`, no store
 * coupling. Powers the `actions` MC field kit widget (module data): text is
 * LITERAL (`literalText` mode of ActionLine/ActionEditor — the raw string
 * lives in LText.key, wire round-trip via `@/lib/literalSteps`). The visual
 * language (rows, tokens, if-blocks, drag reorder) is shared with the
 * element/template click editors in PseudocodeView.
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
  const mutate = (fn: (root: Step[]) => void) => onChange(produce(value, fn));
  return (
    <div className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5 font-mono text-[12px]">
      <ControlledStepTree
        projectId={projectId}
        steps={value}
        frames={[]}
        indent={0}
        mutate={mutate}
      />
    </div>
  );
}

interface TreeProps {
  projectId: ProjectId;
  steps: Step[];
  frames: StepFrame[];
  indent: number;
  mutate: (fn: (root: Step[]) => void) => void;
}

function ControlledStepTree({ projectId, steps, frames, indent, mutate }: TreeProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStepIds(steps);
  const firstMenuId = useAccountStore(
    (s) => menusOf(s.account.projects.find((p) => p.id === projectId))[0]?.id,
  );

  const parentOf = (root: Step[]) => resolveParentMut(root, frames);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;
    mutate((root) => {
      const parent = parentOf(root);
      if (!parent) return;
      const [moved] = parent.splice(fromIndex, 1);
      if (moved) parent.splice(toIndex, 0, moved);
    });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col">
          {steps.map((step, i) => (
            <SortableStep
              // biome-ignore lint/suspicious/noArrayIndexKey: stable per list per render
              key={i}
              id={ids[i]!}
            >
              <ControlledStepLine
                projectId={projectId}
                step={step}
                stepIndex={i}
                frames={frames}
                indent={indent}
                mutate={mutate}
              />
            </SortableStep>
          ))}
          <AddStepLine
            indent={indent}
            firstMenuId={firstMenuId}
            literalText
            onPick={(newStep) =>
              mutate((root) => {
                parentOf(root)?.push(newStep);
              })
            }
          />
        </div>
      </SortableContext>
    </DndContext>
  );
}

function ControlledStepLine({
  projectId,
  step,
  stepIndex,
  frames,
  indent,
  mutate,
}: {
  projectId: ProjectId;
  step: Step;
  stepIndex: number;
  frames: StepFrame[];
  indent: number;
  mutate: (fn: (root: Step[]) => void) => void;
}) {
  const atIf = (root: Step[]) => {
    const s = resolveParentMut(root, frames)?.[stepIndex];
    return s && s.kind === "if" ? s : null;
  };

  const onRemove = () =>
    mutate((root) => {
      resolveParentMut(root, frames)?.splice(stepIndex, 1);
    });

  if (step.kind === "action") {
    return (
      <ActionLine
        action={step.action}
        indent={indent}
        projectId={projectId}
        literalText
        onChange={(next) =>
          mutate((root) => {
            const parent = resolveParentMut(root, frames);
            if (parent) parent[stepIndex] = { kind: "action", action: next };
          })
        }
        onRemove={onRemove}
      />
    );
  }

  return (
    <IfBlock
      step={step}
      indent={indent}
      onRemoveStep={onRemove}
      renderCaseChildren={(caseSteps, descend, childIndent) => (
        <ControlledStepTree
          projectId={projectId}
          steps={caseSteps}
          frames={[...frames, { stepIndex, descend }]}
          indent={childIndent}
          mutate={mutate}
        />
      )}
      onAddCase={() =>
        mutate((root) => {
          atIf(root)?.cases.push({ conditions: [], steps: [] });
        })
      }
      onRemoveCase={(caseIndex) =>
        mutate((root) => {
          atIf(root)?.cases.splice(caseIndex, 1);
        })
      }
      onSetCaseConditions={(caseIndex, conditions) =>
        mutate((root) => {
          const c = atIf(root)?.cases[caseIndex];
          if (c) c.conditions = conditions;
        })
      }
      onSetCaseJoin={(caseIndex, joinIndex, op) =>
        mutate((root) => {
          const c = atIf(root)?.cases[caseIndex];
          if (!c) return;
          const max = Math.max(0, c.conditions.length - 1);
          if (joinIndex < 0 || joinIndex >= max) return;
          if (!c.joins) c.joins = Array(max).fill("and");
          while (c.joins.length < max) c.joins.push("and");
          c.joins[joinIndex] = op;
        })
      }
      onToggleElse={(enabled) =>
        mutate((root) => {
          const s = atIf(root);
          if (!s) return;
          if (enabled) {
            if (!s.else) s.else = [];
          } else {
            s.else = undefined;
          }
        })
      }
    />
  );
}
