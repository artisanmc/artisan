import { cn } from "@/lib/cx";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { type ReactNode, useState } from "react";
import { ServerPlaceholderInput as PlaceholderInput } from "./ServerPlaceholderInput";

export interface RevealFieldProps {
  value: string;
  onChange: (v: string) => void;
  entries: PlaceholderEntry[];
  /** Rendered display shown while the field is NOT being edited. */
  facade: ReactNode;
  /** Preview block rendered below the editor while editing. */
  preview?: ReactNode;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  /** Fires when the field enters edit mode (focus/click). */
  onActivate?: () => void;
  /** Fires when the field leaves edit mode (blur). */
  onDeactivate?: () => void;
  /** Merged after the design-system base class on the editor + facade. */
  className?: string;
  /** Names the field on the facade and on the editor. */
  "aria-label"?: string;
}

/**
 * A field that shows a rendered, read-only facade until the user focuses it.
 * On focus (click or Tab) it swaps to an editable {@link PlaceholderInput}
 * showing the raw source, and reveals the live preview below. An `<input>`
 * can't render styled MiniMessage spans, hence the facade-vs-editor swap.
 */
export function RevealField({
  value,
  onChange,
  entries,
  facade,
  preview,
  placeholder,
  multiline,
  rows,
  onActivate,
  onDeactivate,
  className,
  "aria-label": ariaLabel,
}: RevealFieldProps) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    const activate = () => {
      setEditing(true);
      onActivate?.();
    };
    return (
      <button
        type="button"
        className={cn(
          "w-full cursor-text overflow-hidden text-left",
          multiline ? "textarea block" : "input flex items-center",
          className,
        )}
        onFocus={activate}
        onClick={activate}
        aria-label={ariaLabel}
      >
        {value.trim() ? (
          <span
            className={cn(
              multiline
                ? "block w-full whitespace-pre-wrap break-words"
                : "min-w-0 flex-1 truncate",
            )}
          >
            {facade}
          </span>
        ) : (
          <span className={cn("text-[var(--text-faint)]", !multiline && "min-w-0 flex-1 truncate")}>
            {placeholder}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <PlaceholderInput
        value={value}
        onChange={onChange}
        entries={entries}
        multiline={multiline}
        rows={rows}
        placeholder={placeholder}
        autoFocus
        aria-label={ariaLabel}
        onBlur={() => {
          setEditing(false);
          onDeactivate?.();
        }}
        className={className}
      />
      {preview}
    </div>
  );
}
