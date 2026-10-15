import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StepFrame } from "@/domain/stepPath";
import type {
  Action,
  ClickHandler,
  ClickType,
  CommandId,
  Condition,
  DialogId,
  ElementId,
  IfCase,
  LText,
  MenuId,
  ProjectId,
  Step,
} from "@/domain/types";
import { ActionEditor } from "@/features/canvas/properties/ActionEditor";
import { ConditionListEditor } from "@/features/canvas/properties/ConditionListEditor";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
import { useGetText } from "@/lib/useText";
import { type AppearanceTarget, useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, createContext, useContext, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ACTION_TYPES, defaultAction } from "./defaults";
import { CLICK_TYPE_ORDER, actionTypeLabel, clickTypeLabel, conditionsSummary } from "./labels";
import { menusOf } from "@/domain/documents";

const INDENT = 16;

// Drag-and-drop wiring

/**
 * Listeners + attributes from the nearest @dnd-kit/sortable wrapper. The
 * `<DragHandle/>` button consumes them so it lives inside the row content
 * (right next to the step it drags) rather than at the row's outer edge.
 */
type DragCtx = {
  attributes?: ReturnType<typeof useSortable>["attributes"];
  listeners?: ReturnType<typeof useSortable>["listeners"];
};
const DragHandleContext = createContext<DragCtx>({});

function DragHandle() {
  const { t } = useTranslation();
  const ctx = useContext(DragHandleContext);
  const enabled = !!ctx.listeners;
  // A <span> (with dnd-kit's role="button" attributes), NOT a <button>: the
  // handle lives inside the row's clickable <button> content, and nested
  // buttons are invalid HTML (React 19 flags the hydration hazard).
  return (
    <span
      title={enabled ? t("flow.dragToReorder") : undefined}
      aria-hidden={!enabled}
      {...(enabled ? (ctx.attributes ?? {}) : {})}
      {...(enabled ? (ctx.listeners ?? {}) : {})}
      className={cx(
        "flex h-6 w-5 shrink-0 select-none items-center justify-center rounded text-[12px] leading-none",
        enabled
          ? "cursor-grab touch-none text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:cursor-grabbing"
          : "pointer-events-none opacity-0",
      )}
    >
      ⠿
    </span>
  );
}

/** Wraps a step row with a @dnd-kit/sortable item context. */
export function SortableStep({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <DragHandleContext.Provider value={{ attributes, listeners }}>
        {children}
      </DragHandleContext.Provider>
    </div>
  );
}

/**
 * Per-step stable IDs, by Step *reference identity*. Immer preserves Step
 * refs across `arrayMove` (only the parent array is replaced), so we use a
 * ref-keyed Map to assign each Step a UUID-ish ID the first time we see it
 * and re-use it forever. This is what dnd-kit needs to animate moves
 * correctly — index-based IDs make it think items "swapped" again on the
 * post-drop re-render.
 */
export function useStepIds(steps: Step[]): string[] {
  const mapRef = useRef<WeakMap<Step, string>>(new WeakMap());
  return useMemo(() => {
    const map = mapRef.current;
    return steps.map((step) => {
      let id = map.get(step);
      if (!id) {
        id = `step-${Math.random().toString(36).slice(2, 11)}`;
        map.set(step, id);
      }
      return id;
    });
  }, [steps]);
}

// Element click handlers (parallel to ClickHandlersGrid in FlowCanvas)

interface ElementClickHandlersPseudocodeProps {
  projectId: ProjectId;
  /** Menu context — placeholders and action defaults resolve against it. */
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  click: { [k in ClickType]?: ClickHandler } | undefined;
}

const targetOf = (menuId: MenuId, elementId: ElementId): AppearanceTarget => ({
  menuId,
  elementId,
});

export function ElementClickHandlersPseudocode({
  projectId,
  menuId,
  elementId,
  stateIndex,
  click,
}: ElementClickHandlersPseudocodeProps) {
  const { t } = useTranslation();
  const populated = CLICK_TYPE_ORDER.filter((ct) => click?.[ct]);
  const unpopulated = CLICK_TYPE_ORDER.filter((ct) => !click?.[ct]);
  const addHandler = useAccountStore((s) => s.addElementClickHandler);
  const removeHandler = useAccountStore((s) => s.removeElementClickHandler);
  const target = targetOf(menuId, elementId);

  return (
    <div className="flex flex-col gap-2">
      {populated.map((clickType) => (
        <div
          key={clickType}
          className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] font-mono text-[12px]"
        >
          <div className="flex items-center justify-between border-[var(--border-soft)] border-b px-2 py-1">
            <span className="text-[11px] text-[var(--brand)]">
              {t("flow.clickHandlerOn", { clickType })}
            </span>
            <button
              type="button"
              title={t("flow.clickRemove")}
              onClick={() =>
                removeHandler({ projectId, ...target, appearanceIndex: stateIndex, clickType })
              }
              className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-[var(--text-faint)] leading-none hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              ×
            </button>
          </div>
          <div className="p-1.5">
            <ElementStepTree
              projectId={projectId}
              menuId={menuId}
              elementId={elementId}
              stateIndex={stateIndex}
              clickType={clickType}
              steps={click![clickType]!.steps}
              frames={[]}
              indent={0}
            />
          </div>
        </div>
      ))}
      {unpopulated.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="self-start rounded border border-[var(--border)] border-dashed px-2 py-1.5 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              {t("flow.clickAdd")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
          >
            {unpopulated.map((opt) => (
              <DropdownMenuItem
                key={opt}
                onSelect={() =>
                  addHandler({
                    projectId,
                    ...target,
                    appearanceIndex: stateIndex,
                    clickType: opt,
                  })
                }
                className="cursor-pointer font-mono text-[11px] focus:bg-[var(--surface-hover)]"
              >
                {clickTypeLabel(opt)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// Recursive step tree (element)

interface ElementStepTreeProps {
  projectId: ProjectId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  steps: Step[];
  frames: StepFrame[];
  indent: number;
}

function ElementStepTree(props: ElementStepTreeProps) {
  const { projectId, menuId, elementId, stateIndex, clickType, steps, frames, indent } = props;
  const addElementStep = useAccountStore((s) => s.addElementStep);
  const moveElementStep = useAccountStore((s) => s.moveElementStep);
  const firstMenuId = useAccountStore(
    (s) => menusOf(s.account.projects.find((p) => p.id === projectId))[0]?.id,
  );
  const activeLang = useUiStore((s) => s.activeLang);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStepIds(steps);
  const target = targetOf(menuId, elementId);

  const handleAdd = (newStep: Step) => {
    addElementStep({
      projectId,
      ...target,
      appearanceIndex: stateIndex,
      clickType,
      frames,
      index: steps.length,
      step: newStep,
      lang: activeLang,
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;
    moveElementStep({
      projectId,
      ...target,
      appearanceIndex: stateIndex,
      clickType,
      frames,
      fromIndex,
      toIndex,
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
              <ElementStepLine
                step={step}
                stepIndex={i}
                projectId={projectId}
                menuId={menuId}
                elementId={elementId}
                stateIndex={stateIndex}
                clickType={clickType}
                frames={frames}
                indent={indent}
              />
            </SortableStep>
          ))}
          <AddStepLine indent={indent} firstMenuId={firstMenuId} onPick={handleAdd} />
        </div>
      </SortableContext>
    </DndContext>
  );
}

function ElementStepLine({
  step,
  stepIndex,
  projectId,
  menuId,
  elementId,
  stateIndex,
  clickType,
  frames,
  indent,
}: {
  step: Step;
  stepIndex: number;
  projectId: ProjectId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  frames: StepFrame[];
  indent: number;
}) {
  const removeElementStep = useAccountStore((s) => s.removeElementStep);
  const setElementStep = useAccountStore((s) => s.setElementStep);
  const addIfCase = useAccountStore((s) => s.addIfCase);
  const removeIfCase = useAccountStore((s) => s.removeIfCase);
  const setIfCaseConditions = useAccountStore((s) => s.setIfCaseConditions);
  const setIfCaseJoin = useAccountStore((s) => s.setIfCaseJoin);
  const toggleIfElse = useAccountStore((s) => s.toggleIfElse);
  const activeLang = useUiStore((s) => s.activeLang);
  const target = targetOf(menuId, elementId);

  const onRemove = () =>
    removeElementStep({
      projectId,
      ...target,
      appearanceIndex: stateIndex,
      clickType,
      path: { frames, index: stepIndex },
    });

  if (step.kind === "action") {
    return (
      <ActionLine
        action={step.action}
        indent={indent}
        projectId={projectId}
        menuId={menuId}
        elementId={elementId}
        clickType={clickType}
        onChange={(next) =>
          setElementStep({
            projectId,
            ...target,
            appearanceIndex: stateIndex,
            clickType,
            path: { frames, index: stepIndex },
            step: { kind: "action", action: next },
            lang: activeLang,
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
        <ElementStepTree
          projectId={projectId}
          menuId={menuId}
          elementId={elementId}
          stateIndex={stateIndex}
          clickType={clickType}
          steps={caseSteps}
          frames={[...frames, { stepIndex, descend }]}
          indent={childIndent}
        />
      )}
      onAddCase={() =>
        addIfCase({
          projectId,
          ...target,
          appearanceIndex: stateIndex,
          clickType,
          frames,
          ifStepIndex: stepIndex,
        })
      }
      onRemoveCase={(caseIndex) =>
        removeIfCase({
          projectId,
          ...target,
          appearanceIndex: stateIndex,
          clickType,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
        })
      }
      onSetCaseConditions={(caseIndex, conditions) =>
        setIfCaseConditions({
          projectId,
          ...target,
          appearanceIndex: stateIndex,
          clickType,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
          conditions,
        })
      }
      onSetCaseJoin={(caseIndex, joinIndex, op) =>
        setIfCaseJoin({
          projectId,
          ...target,
          appearanceIndex: stateIndex,
          clickType,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
          joinIndex,
          op,
        })
      }
      onToggleElse={(enabled) =>
        toggleIfElse({
          projectId,
          ...target,
          appearanceIndex: stateIndex,
          clickType,
          frames,
          ifStepIndex: stepIndex,
          enabled,
        })
      }
    />
  );
}

// Command step tree (parallel to CommandStepFlow in FlowCanvas)

interface CommandStepPseudocodeProps {
  projectId: ProjectId;
  commandId: CommandId;
  steps: Step[];
  frames: StepFrame[];
}

export function CommandStepPseudocode({
  projectId,
  commandId,
  steps,
  frames,
}: CommandStepPseudocodeProps) {
  return (
    <div className="font-mono text-[12px]">
      <CommandStepTree
        projectId={projectId}
        commandId={commandId}
        steps={steps}
        frames={frames}
        indent={0}
      />
    </div>
  );
}

function CommandStepTree({
  projectId,
  commandId,
  steps,
  frames,
  indent,
}: {
  projectId: ProjectId;
  commandId: CommandId;
  steps: Step[];
  frames: StepFrame[];
  indent: number;
}) {
  const addCommandStep = useAccountStore((s) => s.addCommandStep);
  const moveCommandStep = useAccountStore((s) => s.moveCommandStep);
  const firstMenuId = useAccountStore(
    (s) => menusOf(s.account.projects.find((p) => p.id === projectId))[0]?.id,
  );
  const activeLang = useUiStore((s) => s.activeLang);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStepIds(steps);

  const handleAdd = (newStep: Step) => {
    addCommandStep({
      projectId,
      commandId,
      frames,
      index: steps.length,
      step: newStep,
      lang: activeLang,
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;
    moveCommandStep({ projectId, commandId, frames, fromIndex, toIndex });
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
              <CommandStepLine
                step={step}
                stepIndex={i}
                projectId={projectId}
                commandId={commandId}
                frames={frames}
                indent={indent}
              />
            </SortableStep>
          ))}
          <AddStepLine indent={indent} firstMenuId={firstMenuId} onPick={handleAdd} />
        </div>
      </SortableContext>
    </DndContext>
  );
}

function CommandStepLine({
  step,
  stepIndex,
  projectId,
  commandId,
  frames,
  indent,
}: {
  step: Step;
  stepIndex: number;
  projectId: ProjectId;
  commandId: CommandId;
  frames: StepFrame[];
  indent: number;
}) {
  const setCommandStep = useAccountStore((s) => s.setCommandStep);
  const removeCommandStep = useAccountStore((s) => s.removeCommandStep);
  const addCommandIfCase = useAccountStore((s) => s.addCommandIfCase);
  const removeCommandIfCase = useAccountStore((s) => s.removeCommandIfCase);
  const setCommandIfCaseConditions = useAccountStore((s) => s.setCommandIfCaseConditions);
  const setCommandIfCaseJoin = useAccountStore((s) => s.setCommandIfCaseJoin);
  const toggleCommandIfElse = useAccountStore((s) => s.toggleCommandIfElse);
  const activeLang = useUiStore((s) => s.activeLang);

  const onRemove = () =>
    removeCommandStep({ projectId, commandId, path: { frames, index: stepIndex } });

  if (step.kind === "action") {
    return (
      <ActionLine
        action={step.action}
        indent={indent}
        projectId={projectId}
        onChange={(next) =>
          setCommandStep({
            projectId,
            commandId,
            path: { frames, index: stepIndex },
            step: { kind: "action", action: next },
            lang: activeLang,
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
        <CommandStepTree
          projectId={projectId}
          commandId={commandId}
          steps={caseSteps}
          frames={[...frames, { stepIndex, descend }]}
          indent={childIndent}
        />
      )}
      onAddCase={() => addCommandIfCase({ projectId, commandId, frames, ifStepIndex: stepIndex })}
      onRemoveCase={(caseIndex) =>
        removeCommandIfCase({ projectId, commandId, frames, ifStepIndex: stepIndex, caseIndex })
      }
      onSetCaseConditions={(caseIndex, conditions) =>
        setCommandIfCaseConditions({
          projectId,
          commandId,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
          conditions,
        })
      }
      onSetCaseJoin={(caseIndex, joinIndex, op) =>
        setCommandIfCaseJoin({
          projectId,
          commandId,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
          joinIndex,
          op,
        })
      }
      onToggleElse={(enabled) =>
        toggleCommandIfElse({ projectId, commandId, frames, ifStepIndex: stepIndex, enabled })
      }
    />
  );
}

// Action / If shared primitives

export function ActionLine({
  action,
  indent,
  projectId,
  onChange,
  onRemove,
  menuId,
  elementId,
  clickType,
  literalText,
}: {
  action: Action;
  indent: number;
  projectId: ProjectId;
  onChange: (next: Action) => void;
  onRemove: () => void;
  menuId?: MenuId;
  elementId?: ElementId;
  clickType?: ClickType;
  /** Literal-text mode for module-data steps — see ActionEditor. */
  literalText?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Pull the active-lang LText resolver for the inline summary (so
  // `send_message: "Hello"` shows real text, not the LText ref). In literal
  // mode the raw string IS the key — resolve it directly.
  const storeGetText = useGetText(projectId);
  const getText = literalText ? (lt: LText | undefined) => lt?.key ?? "" : storeGetText;
  return (
    <>
      <Row
        indent={indent}
        selected={expanded}
        onClick={() => setExpanded((v) => !v)}
        handles={<RowHandles onRemove={onRemove} />}
      >
        <DragHandle />
        <Token kind="action">{action.type}</Token>
        <ActionSummaryArgs action={action} getText={getText} />
      </Row>
      {expanded ? (
        <Expansion indent={indent + 1}>
          <ActionEditor
            projectId={projectId}
            action={action}
            onChange={onChange}
            menuId={menuId}
            elementId={elementId}
            clickType={clickType}
            literalText={literalText}
          />
        </Expansion>
      ) : null}
    </>
  );
}

interface IfBlockProps {
  step: Extract<Step, { kind: "if" }>;
  indent: number;
  onRemoveStep: () => void;
  renderCaseChildren: (
    caseSteps: Step[],
    descend: { case: number } | "else",
    childIndent: number,
  ) => React.ReactNode;
  onAddCase: () => void;
  onRemoveCase: (caseIndex: number) => void;
  onSetCaseConditions: (caseIndex: number, conditions: Condition[]) => void;
  onSetCaseJoin: (caseIndex: number, joinIndex: number, op: "and" | "or") => void;
  onToggleElse: (enabled: boolean) => void;
}

export function IfBlock(props: IfBlockProps) {
  const { t } = useTranslation();
  const {
    step,
    indent,
    onRemoveStep,
    renderCaseChildren,
    onAddCase,
    onRemoveCase,
    onSetCaseConditions,
    onSetCaseJoin,
    onToggleElse,
  } = props;
  return (
    <div className="flex flex-col">
      {step.cases.map((c, ci) => (
        <CaseBlock
          // biome-ignore lint/suspicious/noArrayIndexKey: case index stable per render
          key={ci}
          ifCase={c}
          label={ci === 0 ? "if" : "else if"}
          indent={indent}
          showStepHandles={ci === 0}
          onRemoveStep={onRemoveStep}
          onRemoveCase={ci > 0 ? () => onRemoveCase(ci) : undefined}
          onSetConditions={(conditions) => onSetCaseConditions(ci, conditions)}
          onSetJoin={(joinIndex, op) => onSetCaseJoin(ci, joinIndex, op)}
          renderChildren={(childIndent) => renderCaseChildren(c.steps, { case: ci }, childIndent)}
        />
      ))}
      {step.else ? (
        <ElseBlock
          indent={indent}
          onRemove={() => onToggleElse(false)}
          renderChildren={(childIndent) => renderCaseChildren(step.else!, "else", childIndent)}
        />
      ) : null}
      <div
        className="flex items-center gap-1.5 py-0.5"
        style={{ paddingLeft: indent * INDENT + 4 }}
      >
        <button
          type="button"
          onClick={onAddCase}
          className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          {t("flow.elseIfAdd")}
        </button>
        {!step.else ? (
          <button
            type="button"
            onClick={() => onToggleElse(true)}
            className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("flow.elseAdd")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CaseBlock({
  ifCase,
  label,
  indent,
  showStepHandles,
  onRemoveStep,
  onRemoveCase,
  onSetConditions,
  onSetJoin,
  renderChildren,
}: {
  ifCase: IfCase;
  label: string;
  indent: number;
  showStepHandles: boolean;
  onRemoveStep: () => void;
  onRemoveCase?: () => void;
  onSetConditions: (conditions: Condition[]) => void;
  onSetJoin: (joinIndex: number, op: "and" | "or") => void;
  renderChildren: (childIndent: number) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeConditions(ifCase.conditions, ifCase.joins, t);
  return (
    <>
      <Row
        indent={indent}
        selected={expanded}
        onClick={() => setExpanded((v) => !v)}
        handles={
          showStepHandles ? (
            <RowHandles onRemove={onRemoveStep} />
          ) : onRemoveCase ? (
            <RowHandles onRemove={onRemoveCase} />
          ) : null
        }
      >
        {showStepHandles ? <DragHandle /> : null}
        <Token kind="if">{label}</Token>
        <span className="truncate text-[var(--text-mut)]">{summary}</span>
      </Row>
      {expanded ? (
        <Expansion indent={indent + 1}>
          <ConditionListEditor
            label=""
            conditions={ifCase.conditions}
            joins={ifCase.joins}
            onChange={onSetConditions}
            onJoinChange={onSetJoin}
            emptyHint={t("flow.caseConditionEmpty")}
          />
        </Expansion>
      ) : null}
      {renderChildren(indent + 1)}
    </>
  );
}

function ElseBlock({
  indent,
  onRemove,
  renderChildren,
}: {
  indent: number;
  onRemove: () => void;
  renderChildren: (childIndent: number) => React.ReactNode;
}) {
  return (
    <>
      <Row indent={indent} handles={<RowHandles onRemove={onRemove} />}>
        <Token kind="if">else</Token>
      </Row>
      {renderChildren(indent + 1)}
    </>
  );
}

export function AddStepLine({
  indent,
  firstMenuId,
  onPick,
  allowIf = true,
}: {
  indent: number;
  firstMenuId: MenuId | undefined;
  onPick: (step: Step) => void;
  allowIf?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center py-0.5" style={{ paddingLeft: indent * INDENT + 4 }}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded border border-[var(--border-soft)] border-dashed px-2 py-1 text-[11px] text-[var(--text-faint)] hover:border-[var(--border)] hover:text-[var(--text-mut)]"
          >
            {t("flow.addStep")}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
        >
          {ACTION_TYPES.map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() => onPick({ kind: "action", action: defaultAction(type, firstMenuId) })}
              className="cursor-pointer focus:bg-[var(--surface-hover)]"
            >
              <span className="rounded bg-[var(--surface-raised-2)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--text-mut)]">
                {actionTypeLabel(type)}
              </span>
              <span className="font-mono text-[11px] text-[var(--text)]">{type}</span>
            </DropdownMenuItem>
          ))}
          {allowIf && (
            <DropdownMenuItem
              onSelect={() => onPick({ kind: "if", cases: [{ conditions: [], steps: [] }] })}
              className="cursor-pointer focus:bg-[var(--surface-hover)]"
            >
              <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--brand)]">
                if
              </span>
              <span className="font-mono text-[11px] text-[var(--text)]">
                {t("flow.addStepIfBranch")}
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Visual primitives

function Row({
  indent,
  onClick,
  handles,
  children,
  selected,
}: {
  indent: number;
  onClick?: () => void;
  handles?: React.ReactNode;
  children: React.ReactNode;
  /** Visual selection state — when true, row keeps a subtle background and handles stay visible. */
  selected?: boolean;
}) {
  return (
    <div
      data-row-selected={selected ? "true" : undefined}
      className={cx(
        "group flex min-h-[28px] items-center rounded px-1 hover:bg-[var(--surface-raised)]",
        selected && "bg-[var(--surface-raised)]",
      )}
    >
      <div style={{ width: indent * INDENT }} className="shrink-0" />
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        >
          {children}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 py-1">{children}</div>
      )}
      {handles ? <div className="ml-1 shrink-0">{handles}</div> : null}
    </div>
  );
}

function Token({
  kind,
  children,
}: {
  kind: "action" | "if";
  children: React.ReactNode;
}) {
  const cls =
    kind === "if"
      ? "bg-[var(--brand-soft)] text-[var(--brand)]"
      : "bg-[var(--surface-raised-2)] text-[var(--text-mut)]";
  return (
    <span
      className={cx(
        "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        cls,
      )}
    >
      {children}
    </span>
  );
}

function Expansion({ indent, children }: { indent: number; children: React.ReactNode }) {
  return (
    <div className="flex">
      <div style={{ width: indent * INDENT }} className="shrink-0" />
      <div className="my-1 min-w-0 flex-1 rounded border border-[var(--border-soft)] bg-[var(--surface)] p-2">
        {children}
      </div>
    </div>
  );
}

function RowHandles({ onRemove }: { onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-data-[row-selected=true]:opacity-100">
      <HandleButton title={t("conditions.removeCondition")} onClick={onRemove}>
        ×
      </HandleButton>
    </div>
  );
}

function HandleButton({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cx(
        "flex h-6 w-6 items-center justify-center rounded text-[13px] leading-none",
        disabled
          ? "cursor-not-allowed text-[var(--text-faint)]"
          : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      {children}
    </button>
  );
}

// Helpers

/**
 * Inline summary of an action's args. MiniMessage-bearing actions
 * (send_message / broadcast / show_title) render their text *formatted* so
 * the row shows `<gold><bold>Hi` as actual gold bold text, not raw tags.
 * Everything else falls back to the plain-string {@link actionSummaryArgs}.
 */
function ActionSummaryArgs({
  action,
  getText,
}: {
  action: Action;
  getText: (lt: LText | undefined) => string;
}) {
  if (action.type === "send_message" || action.type === "broadcast") {
    return (
      <span className="min-w-0 truncate text-[var(--text-mut)]">
        "<MiniMessageInline source={getText(action.text)} />"
      </span>
    );
  }
  if (action.type === "show_title") {
    const sub = action.subtitle ? getText(action.subtitle) : null;
    return (
      <span className="min-w-0 truncate text-[var(--text-mut)]">
        "<MiniMessageInline source={getText(action.title)} />"
        {sub !== null ? (
          <>
            {' / "'}
            <MiniMessageInline source={sub} />
            {'"'}
          </>
        ) : null}
      </span>
    );
  }
  return <span className="text-[var(--text-mut)]">{actionSummaryArgs(action, getText)}</span>;
}

/** Compact one-line summary of action params (just the args, no type prefix). */
function actionSummaryArgs(action: Action, getText: (lt: LText | undefined) => string): string {
  switch (action.type) {
    case "open_menu": {
      // Surface the passed context inline — it's load-bearing (parameterized
      // menus) and otherwise only visible after expanding the action.
      const ctx = Object.entries(action.context ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return action.menuId + (ctx ? ` (${ctx})` : "") + (action.clearContext ? " (clear)" : "");
    }
    case "close_menu":
      return "";
    case "open_previous_menu":
      return "";
    case "run_command":
      return `${action.as === "console" ? "[console] " : ""}/${action.command}`;
    case "send_message":
      return `"${getText(action.text)}"`;
    case "show_title": {
      const title = getText(action.title);
      const sub = action.subtitle ? getText(action.subtitle) : null;
      return sub ? `"${title}" / "${sub}"` : `"${title}"`;
    }
    case "give_item":
      return `${action.count}× ${action.material}`;
    case "take_item":
      return `-${action.count}× ${action.material}`;
    case "take_money":
      return `-$${action.amount}`;
    case "give_money":
      return `+$${action.amount}`;
    case "give_xp":
      return `+${action.amount} xp`;
    case "give_level":
      return `+${action.amount} lvl`;
    case "broadcast":
      return `"${getText(action.text)}"`;
    case "play_sound":
      return action.sound;
    case "teleport":
      return `${action.world} ${action.x},${action.y},${action.z}`;
    case "paginate":
      return `${action.direction}${action.targetElementId ? ` ${action.targetElementId}` : " (all)"}`;
    case "set_arg":
      return `${action.arg} = ${action.value}`;
    case "set_arg_cycle_next":
      return `${action.arg} ↻ next ${action.list}`;
    case "set_arg_cycle_prev":
      return `${action.arg} ↻ prev ${action.list}`;
    case "open_dialog":
      return action.dialogId + (action.clearContext ? " (clear)" : "");
    case "close_dialog":
      return "";
    case "run_actions":
      return action.actions;
  }
}

function summarizeConditions(
  conditions: Condition[],
  joins: ("and" | "or")[] | undefined,
  t: (key: string) => string,
): string {
  if (conditions.length === 0) return t("flow.conditionAlways");
  return conditionsSummary(conditions, joins);
}

// Dialog button step pseudocode — mirrors CommandStepPseudocode but scoped
// to a dialog button's `steps` (`dialogsOf(project)[d].buttons[b].steps`).

interface DialogButtonStepPseudocodeProps {
  projectId: ProjectId;
  dialogId: DialogId;
  buttonIndex: number;
  steps: Step[];
  frames: StepFrame[];
}

export function DialogButtonStepPseudocode({
  projectId,
  dialogId,
  buttonIndex,
  steps,
  frames,
}: DialogButtonStepPseudocodeProps) {
  return (
    <div className="font-mono text-[12px]">
      <DialogButtonStepTree
        projectId={projectId}
        dialogId={dialogId}
        buttonIndex={buttonIndex}
        steps={steps}
        frames={frames}
        indent={0}
      />
    </div>
  );
}

function DialogButtonStepTree({
  projectId,
  dialogId,
  buttonIndex,
  steps,
  frames,
  indent,
}: {
  projectId: ProjectId;
  dialogId: DialogId;
  buttonIndex: number;
  steps: Step[];
  frames: StepFrame[];
  indent: number;
}) {
  const addDialogButtonStep = useAccountStore((s) => s.addDialogButtonStep);
  const moveDialogButtonStep = useAccountStore((s) => s.moveDialogButtonStep);
  const firstMenuId = useAccountStore(
    (s) => menusOf(s.account.projects.find((p) => p.id === projectId))[0]?.id,
  );
  const activeLang = useUiStore((s) => s.activeLang);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStepIds(steps);

  const handleAdd = (newStep: Step) => {
    addDialogButtonStep({
      projectId,
      dialogId,
      buttonIndex,
      frames,
      index: steps.length,
      step: newStep,
      lang: activeLang,
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;
    moveDialogButtonStep({ projectId, dialogId, buttonIndex, frames, fromIndex, toIndex });
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
              <DialogButtonStepLine
                step={step}
                stepIndex={i}
                projectId={projectId}
                dialogId={dialogId}
                buttonIndex={buttonIndex}
                frames={frames}
                indent={indent}
              />
            </SortableStep>
          ))}
          <AddStepLine
            indent={indent}
            firstMenuId={firstMenuId}
            onPick={handleAdd}
            allowIf={false}
          />
        </div>
      </SortableContext>
    </DndContext>
  );
}

function DialogButtonStepLine({
  step,
  stepIndex,
  projectId,
  dialogId,
  buttonIndex,
  frames,
  indent,
}: {
  step: Step;
  stepIndex: number;
  projectId: ProjectId;
  dialogId: DialogId;
  buttonIndex: number;
  frames: StepFrame[];
  indent: number;
}) {
  const setDialogButtonStep = useAccountStore((s) => s.setDialogButtonStep);
  const removeDialogButtonStep = useAccountStore((s) => s.removeDialogButtonStep);
  const addDialogButtonIfCase = useAccountStore((s) => s.addDialogButtonIfCase);
  const removeDialogButtonIfCase = useAccountStore((s) => s.removeDialogButtonIfCase);
  const setDialogButtonIfCaseConditions = useAccountStore((s) => s.setDialogButtonIfCaseConditions);
  const setDialogButtonIfCaseJoin = useAccountStore((s) => s.setDialogButtonIfCaseJoin);
  const toggleDialogButtonIfElse = useAccountStore((s) => s.toggleDialogButtonIfElse);
  const activeLang = useUiStore((s) => s.activeLang);

  const onRemove = () =>
    removeDialogButtonStep({
      projectId,
      dialogId,
      buttonIndex,
      path: { frames, index: stepIndex },
    });

  if (step.kind === "action") {
    return (
      <ActionLine
        action={step.action}
        indent={indent}
        projectId={projectId}
        onChange={(next) =>
          setDialogButtonStep({
            projectId,
            dialogId,
            buttonIndex,
            path: { frames, index: stepIndex },
            step: { kind: "action", action: next },
            lang: activeLang,
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
        <DialogButtonStepTree
          projectId={projectId}
          dialogId={dialogId}
          buttonIndex={buttonIndex}
          steps={caseSteps}
          frames={[...frames, { stepIndex, descend }]}
          indent={childIndent}
        />
      )}
      onAddCase={() =>
        addDialogButtonIfCase({
          projectId,
          dialogId,
          buttonIndex,
          frames,
          ifStepIndex: stepIndex,
        })
      }
      onRemoveCase={(caseIndex) =>
        removeDialogButtonIfCase({
          projectId,
          dialogId,
          buttonIndex,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
        })
      }
      onSetCaseConditions={(caseIndex, conditions) =>
        setDialogButtonIfCaseConditions({
          projectId,
          dialogId,
          buttonIndex,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
          conditions,
        })
      }
      onSetCaseJoin={(caseIndex, joinIndex, op) =>
        setDialogButtonIfCaseJoin({
          projectId,
          dialogId,
          buttonIndex,
          frames,
          ifStepIndex: stepIndex,
          caseIndex,
          joinIndex,
          op,
        })
      }
      onToggleElse={(enabled) =>
        toggleDialogButtonIfElse({
          projectId,
          dialogId,
          buttonIndex,
          frames,
          ifStepIndex: stepIndex,
          lang: activeLang,
          enabled,
        })
      }
    />
  );
}
