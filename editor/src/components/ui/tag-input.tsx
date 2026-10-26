import { X } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/cx";

export interface TagInputProps {
  /** Current values, in order. Duplicates are allowed: the caller decides. */
  values: string[];
  /** Commits a typed value (Enter, comma or blur). Return false to keep the draft. */
  onAdd: (value: string) => boolean | undefined;
  onRemove: (index: number) => void;
  placeholder?: string;
  /** Accessible name of the inner text field. */
  label: string;
  /** Accessible name of a value's remove button. */
  removeLabel: (value: string) => string;
  /** Values set in the mono font (ids, keys, durations). */
  mono?: boolean;
  className?: string;
}

/**
 * A short list of scalar values edited as tags in one field: type then Enter
 * (or a comma) to add, the cross to remove. For lists whose values are words,
 * not records — durations, currency ids, material names.
 */
export function TagInput({
  values,
  onAdd,
  onRemove,
  placeholder,
  label,
  removeLabel,
  mono,
  className,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const v = draft.trim();
    if (v === "") return;
    if (onAdd(v) !== false) setDraft("");
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: convenience click that focuses the inner <input>, itself reachable with Tab; the container has no action of its own
    <div
      className={cn(
        "flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-[var(--r-xs)] border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-1 transition-[border-color,box-shadow] focus-within:border-[var(--brand-line)] focus-within:shadow-[var(--ring-brand)]",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((value, i) => (
        <span
          key={`${i}:${value}`}
          className={cn(
            "flex h-6 items-center gap-1 rounded-[5px] bg-[var(--surface-raised-2)] pr-1 pl-2 text-[12px] text-[var(--text)]",
            mono && "font-mono",
          )}
        >
          {value}
          <button
            type="button"
            aria-label={removeLabel(value)}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(i);
            }}
            className="flex size-4 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        className={cn(
          "h-6 min-w-20 flex-1 bg-transparent px-1 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]",
          mono && "font-mono text-[12px]",
        )}
      />
    </div>
  );
}
