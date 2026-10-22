import { type ChainAddress, chainActionContext, chainAllowsIf } from "@/domain/chainAddress";
import { menusOf } from "@/domain/documents";
import type { StepFrame } from "@/domain/stepPath";
import type { ClickType, ElementId, MenuId, ProjectId, Step } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ActionLine, AddStepLine, IfBlock, SortableStep, useStepIds } from "./StepRows";
import { type ChainOps, storeChainOps } from "./chainOps";

/**
 * Editor of one **Action chain** of the Project, addressed by `address`: its edits go to the
 * store reducers of the chain's owner (Element click handler, Command, Dialog button).
 */
export function ActionChainEditor({
  projectId,
  address,
  steps,
}: {
  projectId: ProjectId;
  address: ChainAddress;
  steps: Step[];
}) {
  const activeLang = useUiStore((s) => s.activeLang);
  const ops = storeChainOps(useProjectsStore.getState, projectId, address, activeLang);
  return (
    <StepTree
      projectId={projectId}
      ops={ops}
      steps={steps}
      frames={[]}
      indent={0}
      allowIf={chainAllowsIf(address)}
      actionContext={chainActionContext(address)}
    />
  );
}

export interface StepTreeProps {
  projectId: ProjectId;
  /** Where the edits go: the store (`storeChainOps`) or a controlled value (`controlledChainOps`). */
  ops: ChainOps;
  steps: Step[];
  /** Location of `steps` inside the chain; `[]` for the chain's top level. */
  frames: StepFrame[];
  indent: number;
  /** Whether "+ step" offers an `if` branch. */
  allowIf?: boolean;
  /** Literal-text mode for module-data steps — see ActionEditor. */
  literalText?: boolean;
  /** Menu context the actions are edited in (an Element's click handlers). */
  actionContext?: { menuId?: MenuId; elementId?: ElementId; clickType?: ClickType };
}

/** One Step[] of a chain, drag-sortable, followed by its "+ step" line; recurses into `if`. */
export function StepTree(props: StepTreeProps) {
  const { projectId, ops, steps, frames, indent, allowIf = true, literalText = false } = props;
  const firstMenuId = useProjectsStore(
    (s) => menusOf(s.openProjects.projects.find((p) => p.id === projectId))[0]?.id,
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStepIds(steps);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;
    ops.move(frames, fromIndex, toIndex);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1.5">
          {steps.map((step, i) => (
            <SortableStep
              // biome-ignore lint/suspicious/noArrayIndexKey: stable per list per render
              key={i}
              id={ids[i]!}
            >
              <StepLine {...props} step={step} stepIndex={i} />
            </SortableStep>
          ))}
          <AddStepLine
            indent={indent}
            firstMenuId={firstMenuId}
            onPick={(newStep) => ops.add(frames, steps.length, newStep)}
            allowIf={allowIf}
            literalText={literalText}
          />
        </div>
      </SortableContext>
    </DndContext>
  );
}

function StepLine({ step, stepIndex, ...tree }: StepTreeProps & { step: Step; stepIndex: number }) {
  const { projectId, ops, frames, indent, literalText, actionContext } = tree;
  const onRemove = () => ops.remove({ frames, index: stepIndex });

  if (step.kind === "action") {
    return (
      <ActionLine
        action={step.action}
        projectId={projectId}
        menuId={actionContext?.menuId}
        elementId={actionContext?.elementId}
        clickType={actionContext?.clickType}
        literalText={literalText}
        onChange={(next) => ops.set({ frames, index: stepIndex }, { kind: "action", action: next })}
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
        <StepTree
          {...tree}
          steps={caseSteps}
          frames={[...frames, { stepIndex, descend }]}
          indent={childIndent}
        />
      )}
      onAddCase={() => ops.addCase(frames, stepIndex)}
      onRemoveCase={(caseIndex) => ops.removeCase(frames, stepIndex, caseIndex)}
      onSetCaseConditions={(caseIndex, conditions) =>
        ops.setCaseConditions(frames, stepIndex, caseIndex, conditions)
      }
      onSetCaseJoin={(caseIndex, joinIndex, op) =>
        ops.setCaseJoin(frames, stepIndex, caseIndex, joinIndex, op)
      }
      onToggleElse={(enabled) => ops.toggleElse(frames, stepIndex, enabled)}
    />
  );
}
