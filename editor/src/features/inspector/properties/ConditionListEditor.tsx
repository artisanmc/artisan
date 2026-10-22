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
import { ExpressionConditionField } from "./ExpressionConditionField";

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
  { value: "has_item", label: "has item", chip: "item" },
  { value: "has_xp", label: "has XP", chip: "xp" },
  { value: "has_level", label: "has level", chip: "lvl" },
  { value: "world_is", label: "world is", chip: "world" },
  { value: "time_is", label: "time is", chip: "time" },
  { value: "random_chance", label: "random chance", chip: "%" },
  { value: "cooldown_passed", label: "cooldown passed", chip: "cd" },
  { value: "player_in_region", label: "in region (WorldGuard)", chip: "region" },
  { value: "pagination_at_first", label: "on first page", chip: "⏮" },
  { value: "pagination_at_last", label: "on last page", chip: "⏭" },
  { value: "not", label: "NOT (…)", chip: "NOT" },
  { value: "and", label: "AND group", chip: "AND" },
  { value: "or", label: "OR group", chip: "OR" },
  { value: "expression", label: "expression (advanced)", chip: "expr" },
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
    case "has_item":
      return { type: "has_item", material: "DIAMOND", count: 1 };
    case "has_xp":
      return { type: "has_xp", amount: 1 };
    case "has_level":
      return { type: "has_level", level: 1 };
    case "world_is":
      return { type: "world_is", world: "" };
    case "time_is":
      return { type: "time_is", range: "day" };
    case "random_chance":
      return { type: "random_chance", probability: 0.5 };
    case "cooldown_passed":
      return { type: "cooldown_passed", cooldown_id: "" };
    case "player_in_region":
      return { type: "player_in_region", region: "" };
    case "pagination_at_first":
      return { type: "pagination_at_first" };
    case "pagination_at_last":
      return { type: "pagination_at_last" };
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
          <span className="field-label !mb-0">{label}</span>
        </div>
      ) : null}
      {conditions.length === 0 ? (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface-raised)]/30 px-2 py-1.5 text-[11px] text-[var(--text-faint)]">
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
          "group flex items-center gap-1 rounded border bg-[var(--surface-raised)] px-1.5 py-0.5",
          isDragging ? "border-[var(--brand)]" : "border-[var(--border)]",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab rounded bg-[var(--fam-logic-soft)] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-[var(--fam-logic)] hover:bg-[var(--fam-logic-soft)] active:cursor-grabbing"
            >
              {labelForType(condition.type)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
          >
            {TYPES.map((t) => (
              <DropdownMenuItem
                key={t.value}
                onSelect={() => onChange(defaultCondition(t.value))}
                className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
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
          className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-[var(--text-faint)] opacity-100 hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)] lg:opacity-0 lg:group-hover:opacity-100"
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
          placeholder="artisan.vip"
          value={condition.perm}
          onChange={(e) => onChange({ ...condition, perm: e.target.value })}
          className="h-6 w-[140px] px-1.5 py-0 text-[11px]"
        />
      );
    case "has_money":
      return (
        <>
          <span className="font-mono text-[11px] text-[var(--text-faint)]">≥</span>
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
          <span className="font-mono text-[11px] text-[var(--text-faint)]">=</span>
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
          <span className="font-mono text-[11px] text-[var(--text-faint)]">~</span>
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
        <div className="flex items-center gap-1 rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface)]/50 px-1 py-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded bg-[var(--fam-logic-soft)] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-[var(--fam-logic)] hover:bg-[var(--fam-logic-soft)]"
              >
                {labelForType(condition.of.type)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
            >
              {TYPES.filter((t) => t.value !== "not").map((t) => (
                <DropdownMenuItem
                  key={t.value}
                  onSelect={() => onChange({ type: "not", of: defaultCondition(t.value) })}
                  className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
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
    case "has_item":
      return (
        <>
          <Input
            placeholder="DIAMOND"
            value={condition.material}
            onChange={(e) => onChange({ ...condition, material: e.target.value })}
            className="h-6 w-[120px] px-1.5 py-0 font-mono text-[11px]"
          />
          <span className="font-mono text-[11px] text-[var(--text-faint)]">×</span>
          <Input
            type="number"
            min={1}
            value={condition.count}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n) && n >= 1) onChange({ ...condition, count: n });
            }}
            className="h-6 w-[55px] px-1.5 py-0 text-[11px]"
          />
        </>
      );
    case "has_xp":
    case "has_level": {
      const value = condition.type === "has_xp" ? condition.amount : condition.level;
      return (
        <>
          <span className="font-mono text-[11px] text-[var(--text-faint)]">≥</span>
          <Input
            type="number"
            min={1}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isNaN(n) || n < 1) return;
              onChange(
                condition.type === "has_xp"
                  ? { ...condition, amount: n }
                  : { ...condition, level: n },
              );
            }}
            className="h-6 w-[70px] px-1.5 py-0 text-[11px]"
          />
        </>
      );
    }
    case "world_is":
      return (
        <Input
          placeholder="world"
          value={condition.world}
          onChange={(e) => onChange({ ...condition, world: e.target.value })}
          className="h-6 w-[110px] px-1.5 py-0 font-mono text-[11px]"
        />
      );
    case "time_is": {
      return (
        <>
          <select
            value={typeof condition.range === "object" ? "custom" : condition.range}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...condition,
                range: v === "custom" ? { from_ticks: 0, to_ticks: 12000 } : (v as "day" | "night"),
              });
            }}
            className="h-6 rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1 font-mono text-[11px] text-[var(--text)]"
          >
            <option value="day">day</option>
            <option value="night">night</option>
            <option value="custom">ticks…</option>
          </select>
          {typeof condition.range === "object" ? (
            <>
              <Input
                type="number"
                min={0}
                max={24000}
                value={condition.range.from_ticks}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n) && typeof condition.range === "object")
                    onChange({ ...condition, range: { ...condition.range, from_ticks: n } });
                }}
                className="h-6 w-[70px] px-1.5 py-0 text-[11px]"
              />
              <span className="font-mono text-[11px] text-[var(--text-faint)]">→</span>
              <Input
                type="number"
                min={0}
                max={24000}
                value={condition.range.to_ticks}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n) && typeof condition.range === "object")
                    onChange({ ...condition, range: { ...condition.range, to_ticks: n } });
                }}
                className="h-6 w-[70px] px-1.5 py-0 text-[11px]"
              />
            </>
          ) : null}
        </>
      );
    }
    case "random_chance":
      return (
        <>
          <span className="font-mono text-[11px] text-[var(--text-faint)]">p =</span>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={condition.probability}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n) && n >= 0 && n <= 1) onChange({ ...condition, probability: n });
            }}
            className="h-6 w-[70px] px-1.5 py-0 text-[11px]"
          />
        </>
      );
    case "cooldown_passed":
      return (
        <Input
          placeholder="daily_reward"
          value={condition.cooldown_id}
          onChange={(e) => onChange({ ...condition, cooldown_id: e.target.value })}
          className="h-6 w-[130px] px-1.5 py-0 font-mono text-[11px]"
        />
      );
    case "player_in_region":
      return (
        <Input
          placeholder="shop_zone"
          value={condition.region}
          onChange={(e) => onChange({ ...condition, region: e.target.value })}
          className="h-6 w-[130px] px-1.5 py-0 font-mono text-[11px]"
        />
      );
    case "pagination_at_first":
    case "pagination_at_last":
      return (
        <Input
          placeholder="(all iterables)"
          value={condition.elementId ?? ""}
          onChange={(e) => onChange({ ...condition, elementId: e.target.value || undefined })}
          className="h-6 w-[120px] px-1.5 py-0 font-mono text-[11px]"
        />
      );
    case "expression":
      return (
        <ExpressionConditionField
          expr={condition.expr}
          onChange={(expr) => onChange({ ...condition, expr })}
        />
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
    <div className="flex flex-wrap items-center gap-1 rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface)]/50 px-1 py-0.5">
      {condition.of.length === 0 ? (
        <span className="font-mono text-[11px] text-[var(--text-faint)] italic">empty</span>
      ) : (
        condition.of.map((inner, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: index stable per render
          <Fragment key={i}>
            {i > 0 ? (
              <span className="select-none text-[11px] font-medium text-[var(--text-faint)]">
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
    <div className="group flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded bg-[var(--fam-logic-soft)] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-[var(--fam-logic)] hover:bg-[var(--fam-logic-soft)]"
          >
            {labelForType(condition.type)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
        >
          {TYPES.map((t) => (
            <DropdownMenuItem
              key={t.value}
              onSelect={() => onChange(defaultCondition(t.value))}
              className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
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
        className="rounded px-1 text-[11px] text-[var(--text-faint)] opacity-0 hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)] group-hover:opacity-100"
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
          className="rounded border border-[var(--border)] border-dashed px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          {joiner ? `+ ${joiner}` : "+ add"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
      >
        {TYPES.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onSelect={() => onPick(t.value)}
            className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
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
      <span className="select-none text-[11px] font-medium text-[var(--text-faint)]">{label}</span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      title={t("conditions.switchOperator")}
      className={cx(
        "rounded px-1 font-mono text-[10.5px] font-medium transition-colors",
        op === "or"
          ? "bg-[var(--warning-soft)] text-[var(--warning)] hover:bg-[var(--warning)]/25"
          : "bg-[var(--fam-logic-soft)] text-[var(--fam-logic)] hover:bg-[var(--fam-logic-soft)]",
      )}
    >
      {label}
    </button>
  );
}
