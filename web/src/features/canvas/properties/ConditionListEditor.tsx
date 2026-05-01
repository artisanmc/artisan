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
import { useId } from "react";

interface ConditionListEditorProps {
  /** Label shown above the list (e.g. "visibility", "when"). */
  label: string;
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
  /** Hint shown when the list is empty. */
  emptyHint?: string;
  /**
   * Boolean join mode. "all" → AND-join the chips; "any" → OR-join. When
   * undefined the editor falls back to AND and hides the toggle (used for
   * legacy callers like state visibility — those can be opted in later).
   */
  match?: "all" | "any";
  onMatchChange?: (match: "all" | "any") => void;
}

const TYPES: Array<{ value: Condition["type"]; label: string; chip: string }> = [
  { value: "has_permission", label: "has permission", chip: "perm" },
  { value: "has_money", label: "has money", chip: "$" },
  { value: "not", label: "NOT (…)", chip: "NOT" },
];

const defaultCondition = (type: Condition["type"]): Condition => {
  switch (type) {
    case "has_permission":
      return { type: "has_permission", perm: "" };
    case "has_money":
      return { type: "has_money", amount: 0 };
    case "not":
      return { type: "not", of: { type: "has_permission", perm: "" } };
  }
};

const labelForType = (t: Condition["type"]): string => TYPES.find((x) => x.value === t)?.chip ?? t;

export function ConditionListEditor({
  label,
  conditions,
  onChange,
  emptyHint,
  match,
  onMatchChange,
}: ConditionListEditorProps) {
  const joiner = match === "any" ? "OR" : "AND";
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

  const headerVisible = label || (onMatchChange && conditions.length > 1);
  return (
    <div>
      {headerVisible ? (
        <div className="mb-1 flex items-center justify-between gap-2">
          {label ? <span className="text-[10px] uppercase text-zinc-500">{label}</span> : <span />}
          {onMatchChange && conditions.length > 1 ? (
            <MatchToggle match={match ?? "all"} onChange={onMatchChange} />
          ) : null}
        </div>
      ) : null}
      {conditions.length === 0 ? (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 rounded border border-zinc-800 border-dashed bg-zinc-900/30 px-2 py-1.5 text-[11px] text-zinc-500">
            {emptyHint ?? "always (no condition)"}
          </div>
          <AppendChip onPick={append} joiner={joiner} />
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
                  joiner={i > 0 ? joiner : null}
                  onChange={(next) => updateAt(i, next)}
                  onRemove={() => removeAt(i)}
                />
              ))}
              <AppendChip onPick={append} joiner={conditions.length > 0 ? joiner : null} />
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
  /** When set, render this joiner badge before the chip ("AND" / "OR"). */
  joiner: string | null;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}

function ConditionChip({ id, condition, joiner, onChange, onRemove }: ConditionChipProps) {
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
      {joiner ? (
        <span className="select-none font-mono text-[9px] uppercase tracking-wide text-zinc-500">
          {joiner}
        </span>
      ) : null}
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
          title="Remove"
          onClick={onRemove}
          className="rounded px-1 text-[10px] text-zinc-500 opacity-0 hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100"
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
  }
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

function MatchToggle({
  match,
  onChange,
}: {
  match: "all" | "any";
  onChange: (match: "all" | "any") => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-zinc-700 text-[9px]">
      {(["all", "any"] as const).map((value) => {
        const active = match === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cx(
              "px-1.5 py-0.5 font-mono uppercase tracking-wide transition-colors",
              active
                ? "bg-emerald-500/20 text-emerald-200"
                : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
            )}
            title={value === "all" ? "match ALL (AND)" : "match ANY (OR)"}
          >
            {value === "all" ? "AND" : "OR"}
          </button>
        );
      })}
    </div>
  );
}
