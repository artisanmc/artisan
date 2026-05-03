import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Condition } from "@/domain/types";
import { cx } from "@/lib/cx";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Fragment, useId } from "react";
import { useTranslation } from "react-i18next";

interface ConditionListEditorProps {
  /** Label shown above the list (e.g. "visibility", "when"). */
  label: string;
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
  /** Hint shown when the list is empty. */
  emptyHint?: string;
  /**
   * Per-joiner boolean operators. joins[i] is between conditions[i] and
   * conditions[i+1]; undefined defaults to "and". When omitted altogether,
   * joiners render as static "AND" badges (used by callers that don't yet
   * persist per-joiner state, e.g. Appearance.if visibility).
   */
  joins?: ("and" | "or")[];
  onJoinChange?: (joinIndex: number, op: "and" | "or") => void;
}

const TYPES: Array<{ value: Condition["type"]; label: string; chip: string }> = [
  { value: "has_permission", label: "has permission", chip: "perm" },
  { value: "has_money", label: "has money", chip: "$" },
  { value: "placeholder_equals", label: "placeholder = value", chip: "= value" },
  { value: "placeholder_match", label: "placeholder ~ regex", chip: "~ regex" },
  { value: "not", label: "NOT (…)", chip: "NOT" },
  { value: "and", label: "AND group", chip: "AND" },
  { value: "or", label: "OR group", chip: "OR" },
];

const defaultCondition = (type: Condition["type"]): Condition => {
  switch (type) {
    case "has_permission":
      return { type: "has_permission", perm: "" };
    case "has_money":
      return { type: "has_money", amount: 0 };
    case "placeholder_equals":
      return { type: "placeholder_equals", placeholder: "", value: "" };
    case "placeholder_match":
      return { type: "placeholder_match", placeholder: "", regex: "" };
    case "not":
      return { type: "not", of: { type: "has_permission", perm: "" } };
    case "and":
      return { type: "and", of: [{ type: "has_permission", perm: "" }] };
    case "or":
      return { type: "or", of: [{ type: "has_permission", perm: "" }] };
    case "expression":
      return { type: "expression", expr: "" };
  }
};

const labelForType = (t: Condition["type"]): string => TYPES.find((x) => x.value === t)?.chip ?? t;

export function ConditionListEditor({
  label,
  conditions,
  onChange,
  emptyHint,
  joins,
  onJoinChange,
}: ConditionListEditorProps) {
  const { t } = useTranslation();
  const joinAt = (i: number): "and" | "or" => joins?.[i] ?? "and";
  const baseId = useId();

  const updateAt = (i: number, next: Condition) => {
    const copy = conditions.slice();
    copy[i] = next;
    onChange(copy);
  };
  const removeAt = (i: number) => {
    const copy = conditions.slice();
    copy.splice(i, 1);
    onChange(copy);
  };
  const append = (type: Condition["type"]) => {
    onChange([...conditions, defaultCondition(type)]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.over.id === e.active.id) return;
    const oldIndex = Number(String(e.active.id).split(":").pop());
    const newIndex = Number(String(e.over.id).split(":").pop());
    if (Number.isNaN(oldIndex) || Number.isNaN(newIndex)) return;
    onChange(arrayMove(conditions, oldIndex, newIndex));
  };
  const ids = conditions.map((_, i) => `${baseId}:${i}`);

  const lastJoiner = conditions.length === 0 ? "and" : joinAt(Math.max(0, conditions.length - 2));
  return (
    <div>
      {label ? (
        <div className="mb-1">
          <span className="text-[10px] uppercase text-zinc-500">{label}</span>
        </div>
      ) : null}
      {conditions.length === 0 ? (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 rounded border border-zinc-800 border-dashed bg-zinc-900/30 px-2 py-1.5 text-[11px] text-zinc-500">
            {emptyHint ?? t("conditions.alwaysNoCondition")}
          </div>
          <AppendChip onPick={append} joiner="AND" />
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-wrap items-center gap-1.5">
              {conditions.map((c, i) => (
                <ConditionChip
                  key={ids[i]}
                  id={ids[i]!}
                  condition={c}
                  joiner={
                    i > 0
                      ? {
                          op: joinAt(i - 1),
                          onToggle: onJoinChange
                            ? () => onJoinChange(i - 1, joinAt(i - 1) === "and" ? "or" : "and")
                            : undefined,
                        }
                      : null
                  }
                  onChange={(next) => updateAt(i, next)}
                  onRemove={() => removeAt(i)}
                />
              ))}
              <AppendChip
                onPick={append}
                joiner={conditions.length > 0 ? (lastJoiner === "or" ? "OR" : "AND") : null}
              />
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

interface ConditionChipProps {
  id: string;
  condition: Condition;
  /** When set, render this joiner before the chip. onToggle flips AND ↔ OR. */
  joiner: { op: "and" | "or"; onToggle?: () => void } | null;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}

function ConditionChip({ id, condition, joiner, onChange, onRemove }: ConditionChipProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <>
      {joiner ? <JoinerToggle op={joiner.op} onToggle={joiner.onToggle} /> : null}
      <div
        ref={setNodeRef}
        style={style}
        className={cx(
          "group flex items-center gap-1 rounded border bg-zinc-900 px-1.5 py-0.5",
          isDragging ? "border-emerald-500" : "border-zinc-700",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-200 hover:bg-zinc-700 active:cursor-grabbing"
            >
              {labelForType(condition.type)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
            {TYPES.map((t) => (
              <DropdownMenuItem
                key={t.value}
                onSelect={() => onChange(defaultCondition(t.value))}
                className="cursor-pointer text-[11px] focus:bg-zinc-800"
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ConditionInline condition={condition} onChange={onChange} />
        <button
          type="button"
          title={t("conditions.removeCondition")}
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-zinc-500 opacity-100 hover:bg-zinc-800 hover:text-zinc-200 lg:opacity-0 lg:group-hover:opacity-100"
        >
          ×
        </button>
      </div>
    </>
  );
}

/**
 * Compact inline editor for a condition's payload — fits next to the type
 * pill inside the chip. NOT renders a nested mini-chip for its inner.
 */
function ConditionInline({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (next: Condition) => void;
}) {
  const { t } = useTranslation();
  switch (condition.type) {
    case "has_permission":
      return (
        <Input
          placeholder="interfaze.vip"
          value={condition.perm}
          onChange={(e) => onChange({ ...condition, perm: e.target.value })}
          className="h-6 w-[140px] px-1.5 py-0 text-[11px]"
        />
      );
    case "has_money":
      return (
        <>
          <span className="font-mono text-[10px] text-zinc-500">≥</span>
          <Input
            type="number"
            min={0}
            value={condition.amount}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n) && n >= 0) onChange({ ...condition, amount: n });
            }}
            className="h-6 w-[80px] px-1.5 py-0 text-[11px]"
          />
        </>
      );
    case "placeholder_equals":
      return (
        <>
          <Input
            placeholder={t("conditions.placeholderPlaceholder")}
            value={condition.placeholder}
            onChange={(e) => onChange({ ...condition, placeholder: e.target.value })}
            className="h-6 w-[120px] px-1.5 py-0 font-mono text-[11px]"
          />
          <span className="font-mono text-[10px] text-zinc-500">=</span>
          <Input
            placeholder={t("conditions.placeholderValuePlaceholder")}
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            className="h-6 w-[100px] px-1.5 py-0 text-[11px]"
          />
        </>
      );
    case "placeholder_match":
      return (
        <>
          <Input
            placeholder={t("conditions.placeholderPlaceholder")}
            value={condition.placeholder}
            onChange={(e) => onChange({ ...condition, placeholder: e.target.value })}
            className="h-6 w-[120px] px-1.5 py-0 font-mono text-[11px]"
          />
          <span className="font-mono text-[10px] text-zinc-500">~</span>
          <Input
            placeholder={t("conditions.placeholderRegexPlaceholder")}
            value={condition.regex}
            onChange={(e) => onChange({ ...condition, regex: e.target.value })}
            className="h-6 w-[100px] px-1.5 py-0 font-mono text-[11px]"
          />
        </>
      );
    case "not":
      return (
        <div className="flex items-center gap-1 rounded border border-zinc-800 border-dashed bg-zinc-950/50 px-1 py-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-200 hover:bg-zinc-700"
              >
                {labelForType(condition.of.type)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-zinc-700 bg-zinc-900 text-zinc-200"
            >
              {TYPES.filter((t) => t.value !== "not").map((t) => (
                <DropdownMenuItem
                  key={t.value}
                  onSelect={() => onChange({ type: "not", of: defaultCondition(t.value) })}
                  className="cursor-pointer text-[11px] focus:bg-zinc-800"
                >
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ConditionInline
            condition={condition.of}
            onChange={(next) => onChange({ type: "not", of: next })}
          />
        </div>
      );
    case "and":
    case "or":
      return <CompositeInner condition={condition} onChange={onChange} />;
  }
}

/**
 * Inline editor for an AND/OR composite condition. Renders inner conditions
 * as mini-chips joined by the operator, with a per-chip × and an appender at
 * the end. Recursive: inner chips can themselves be AND/OR/NOT composites.
 */
function CompositeInner({
  condition,
  onChange,
}: {
  condition: Extract<Condition, { type: "and" | "or" }>;
  onChange: (next: Condition) => void;
}) {
  const op = condition.type === "and" ? "AND" : "OR";
  const updateInner = (i: number, next: Condition) => {
    const copy = condition.of.slice();
    copy[i] = next;
    onChange({ ...condition, of: copy });
  };
  const removeInner = (i: number) => {
    const copy = condition.of.slice();
    copy.splice(i, 1);
    onChange({ ...condition, of: copy });
  };
  const append = (type: Condition["type"]) =>
    onChange({ ...condition, of: [...condition.of, defaultCondition(type)] });
  return (
    <div className="flex flex-wrap items-center gap-1 rounded border border-zinc-800 border-dashed bg-zinc-950/50 px-1 py-0.5">
      {condition.of.length === 0 ? (
        <span className="font-mono text-[10px] text-zinc-600 italic">empty</span>
      ) : (
        condition.of.map((inner, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: index stable per render
          <Fragment key={i}>
            {i > 0 ? (
              <span className="select-none font-mono text-[9px] uppercase tracking-wide text-zinc-500">
                {op}
              </span>
            ) : null}
            <InnerChip
              condition={inner}
              onChange={(next) => updateInner(i, next)}
              onRemove={() => removeInner(i)}
            />
          </Fragment>
        ))
      )}
      <AppendChip onPick={append} joiner={op} />
    </div>
  );
}

/**
 * A non-sortable chip used inside composite conditions. Same shape as
 * ConditionChip but without the drag handle wiring.
 */
function InnerChip({
  condition,
  onChange,
  onRemove,
}: {
  condition: Condition;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-200 hover:bg-zinc-700"
          >
            {labelForType(condition.type)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
          {TYPES.map((t) => (
            <DropdownMenuItem
              key={t.value}
              onSelect={() => onChange(defaultCondition(t.value))}
              className="cursor-pointer text-[11px] focus:bg-zinc-800"
            >
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConditionInline condition={condition} onChange={onChange} />
      <button
        type="button"
        title={t("conditions.removeCondition")}
        onClick={onRemove}
        className="rounded px-1 text-[10px] text-zinc-500 opacity-0 hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

function AppendChip({
  onPick,
  joiner,
}: {
  onPick: (type: Condition["type"]) => void;
  joiner?: string | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded border border-zinc-700 border-dashed px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          {joiner ? `+ ${joiner}` : "+ add"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
        {TYPES.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onSelect={() => onPick(t.value)}
            className="cursor-pointer text-[11px] focus:bg-zinc-800"
          >
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Per-link AND/OR badge between two condition chips. Click to toggle. When
 * onToggle is undefined (e.g. legacy callers without persisted joins), the
 * badge renders read-only.
 */
function JoinerToggle({ op, onToggle }: { op: "and" | "or"; onToggle?: () => void }) {
  const { t } = useTranslation();
  const label = op === "or" ? "OR" : "AND";
  if (!onToggle) {
    return (
      <span className="select-none font-mono text-[9px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      title={t("conditions.switchOperator")}
      className={cx(
        "rounded px-1 font-mono text-[9px] uppercase tracking-wide transition-colors",
        op === "or"
          ? "bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700",
      )}
    >
      {label}
    </button>
  );
}
