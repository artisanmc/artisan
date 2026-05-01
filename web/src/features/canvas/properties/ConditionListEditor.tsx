import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Condition } from "@/domain/types";

interface ConditionListEditorProps {
  /** Label shown above the list (e.g. "visibility", "requirements"). */
  label: string;
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
  /** Hint shown when the list is empty. */
  emptyHint?: string;
}

const TYPES: Array<{ value: Condition["type"]; label: string }> = [
  { value: "has_permission", label: "has permission" },
  { value: "has_money", label: "has money" },
  { value: "not", label: "NOT (…)" },
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

export function ConditionListEditor({
  label,
  conditions,
  onChange,
  emptyHint,
}: ConditionListEditorProps) {
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
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase text-zinc-500">{label}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded border border-zinc-700 border-dashed px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              + add
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-zinc-700 bg-zinc-900 text-zinc-200">
            {TYPES.map((t) => (
              <DropdownMenuItem
                key={t.value}
                onSelect={() => append(t.value)}
                className="cursor-pointer text-[11px] focus:bg-zinc-800"
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {conditions.length === 0 ? (
        <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/30 px-2 py-2 text-[11px] text-zinc-500">
          {emptyHint ?? "always (no condition)"}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {conditions.map((c, i) => (
            <ConditionRow
              // biome-ignore lint/suspicious/noArrayIndexKey: stable per render
              key={i}
              condition={c}
              onChange={(next) => updateAt(i, next)}
              onRemove={() => removeAt(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ConditionRowProps {
  condition: Condition;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}

function ConditionRow({ condition, onChange, onRemove }: ConditionRowProps) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-1.5">
      <div className="mb-1 flex items-center justify-between gap-1">
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
        <button
          type="button"
          title="Remove"
          onClick={onRemove}
          className="rounded px-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ×
        </button>
      </div>
      <ConditionFields condition={condition} onChange={onChange} />
    </div>
  );
}

function ConditionFields({
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
          placeholder="permission node, e.g. interfaze.vip"
          value={condition.perm}
          onChange={(e) => onChange({ ...condition, perm: e.target.value })}
        />
      );
    case "has_money":
      return (
        <Input
          type="number"
          min={0}
          value={condition.amount}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n) && n >= 0) onChange({ ...condition, amount: n });
          }}
        />
      );
    case "not":
      return (
        <div className="rounded border border-zinc-800 border-dashed bg-zinc-950 p-1.5">
          <div className="mb-1 text-[9px] uppercase text-zinc-600">inner</div>
          <ConditionFields
            condition={condition.of}
            onChange={(next) => onChange({ type: "not", of: next })}
          />
          <InnerTypeSwitcher
            type={condition.of.type}
            onChange={(t) => onChange({ type: "not", of: defaultCondition(t) })}
          />
        </div>
      );
  }
}

function InnerTypeSwitcher({
  type,
  onChange,
}: {
  type: Condition["type"];
  onChange: (t: Condition["type"]) => void;
}) {
  return (
    <div className="mt-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-200 hover:bg-zinc-700"
          >
            {labelForType(type)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
          {TYPES.filter((t) => t.value !== "not").map((t) => (
            <DropdownMenuItem
              key={t.value}
              onSelect={() => onChange(t.value)}
              className="cursor-pointer text-[11px] focus:bg-zinc-800"
            >
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const labelForType = (t: Condition["type"]): string => {
  switch (t) {
    case "has_permission":
      return "perm";
    case "has_money":
      return "money";
    case "not":
      return "NOT";
  }
};
