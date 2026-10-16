import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isLTextNode, normalizeActionArgs } from "@/domain/actionArgs";
import type {
  Action,
  ClickType,
  Condition,
  ElementId,
  IfCase,
  LText,
  MenuId,
  ProjectId,
  Step,
} from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useDeclaredActionOf } from "@/lib/actions/coreActions";
import type { DeclaredAction } from "@/lib/api/declaredActions";
import { cx } from "@/lib/cx";
import { useGetText } from "@/lib/useText";
import { moduleActionsOf, useServerActionsStore } from "@/state/serverActionsStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, createContext, useContext, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionEditor } from "../properties/ActionEditor";
import { ConditionListEditor } from "../properties/ConditionListEditor";
import { ACTION_TYPES, defaultAction, defaultDeclaredAction } from "./defaults";
import { actionTypeLabel, conditionsSummary } from "./labels";

/*
 * The rows of the Action chain editor: one line per action, `if` / `else if` / `else` blocks,
 * the "+ step" picker, and the drag handle wiring. `StepTree` assembles them.
 */

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
        <Token kind="action">{action.name}</Token>
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
  literalText = false,
}: {
  indent: number;
  firstMenuId: MenuId | undefined;
  onPick: (step: Step) => void;
  allowIf?: boolean;
  /** Literal-text mode for module-data steps — a module action's texts seed as strings. */
  literalText?: boolean;
}) {
  const { t } = useTranslation();
  // Actions a module registered on the active server (ADR extensible-document-kinds, R1).
  const declared = useServerActionsStore((s) => s.actions);
  const moduleActions = moduleActionsOf(declared);
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
          {ACTION_TYPES.map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() => onPick({ kind: "action", action: defaultAction(name, firstMenuId) })}
              className="cursor-pointer focus:bg-[var(--surface-hover)]"
            >
              <span className="rounded bg-[var(--surface-raised-2)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--text-mut)]">
                {actionTypeLabel(name)}
              </span>
              <span className="font-mono text-[11px] text-[var(--text)]">{name}</span>
            </DropdownMenuItem>
          ))}
          {moduleActions.map((decl) => (
            <DropdownMenuItem
              key={decl.name}
              onSelect={() =>
                onPick({ kind: "action", action: defaultDeclaredAction(decl, { literalText }) })
              }
              className="cursor-pointer focus:bg-[var(--surface-hover)]"
            >
              <span className="rounded bg-[var(--surface-raised-2)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--text-mut)]">
                {decl.moduleId}
              </span>
              <span className="font-mono text-[11px] text-[var(--text)]">{decl.name}</span>
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
 * Inline summary of an action's args, read through its declaration. Text arguments render
 * *formatted* so the row shows `<gold><bold>Hi` as actual gold bold text, not raw tags;
 * the other arguments fall back to the plain-string {@link actionSummaryArgs}.
 */
function ActionSummaryArgs({
  action,
  getText,
}: {
  action: Action;
  getText: (lt: LText | undefined) => string;
}) {
  const declOf = useDeclaredActionOf();
  const decl = declOf(action.name);
  const args = decl ? normalizeActionArgs(decl, action.value) : {};
  const texts = decl
    ? decl.args.filter((a) => a.type.kind === "ltext" && isLTextNode(args[a.name]))
    : [];
  if (texts.length === 0) {
    return (
      <span className="text-[var(--text-mut)]">{actionSummaryArgs(action, getText, decl)}</span>
    );
  }
  const rest = actionSummaryArgs(action, getText, decl, new Set(texts.map((a) => a.name)));
  return (
    <span className="min-w-0 truncate text-[var(--text-mut)]">
      {texts.map((a, i) => (
        <span key={a.name}>
          {i > 0 ? " / " : ""}"<MiniMessageInline source={getText(args[a.name] as LText)} />"
        </span>
      ))}
      {rest ? ` ${rest}` : ""}
    </span>
  );
}

/**
 * Compact one-line summary of action params (just the args, no name prefix): the primary
 * argument first, then the others as `name=value`, a set flag as `(name)`; texts read in the
 * active language. An undeclared action shows its wire value.
 */
function actionSummaryArgs(
  action: Action,
  getText: (lt: LText | undefined) => string,
  decl: DeclaredAction | undefined,
  skip: Set<string> = new Set(),
): string {
  if (!decl) return summarizeModuleValue(action.value, getText);
  const args = normalizeActionArgs(decl, action.value);
  const show = (v: unknown): string => {
    if (isLTextNode(v)) return `"${getText(v)}"`;
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(show).join(", ");
    if (typeof v === "object" && v !== null)
      return Object.entries(v)
        .map(([k, x]) => `${k}=${show(x)}`)
        .join(", ");
    return String(v);
  };
  const parts: string[] = [];
  const primary = decl.primary;
  if (primary && args[primary] !== undefined && !skip.has(primary)) parts.push(show(args[primary]));
  for (const arg of decl.args) {
    if (arg.name === primary || skip.has(arg.name)) continue;
    const v = args[arg.name];
    if (v === undefined) continue;
    if (v === true) parts.push(`(${arg.name})`);
    else if (v === false) continue;
    else parts.push(`${arg.name}=${show(v)}`);
  }
  return parts.join(" ");
}

/** An undeclared action's value in one line: adopted texts read in the active language, the rest as JSON. */
function summarizeModuleValue(value: unknown, getText: (lt: LText | undefined) => string): string {
  if (value == null) return "";
  if (isLTextNode(value)) return getText(value);
  if (Array.isArray(value)) return value.map((v) => summarizeModuleValue(v, getText)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${isLTextNode(v) ? getText(v) : JSON.stringify(v)}`)
      .join(", ");
  }
  return String(value);
}

function summarizeConditions(
  conditions: Condition[],
  joins: ("and" | "or")[] | undefined,
  t: (key: string) => string,
): string {
  if (conditions.length === 0) return t("flow.conditionAlways");
  return conditionsSummary(conditions, joins);
}
