import { CHAT, TEXT_LINE } from "@/lib/mm/profiles";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import type { MouseEvent } from "react";
import { MmEditor } from "./minimessage/MmEditor";

export interface MiniMessageFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Placeholders offered while typing `{`; none by default. */
  entries?: PlaceholderEntry[];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

const NO_ENTRIES: PlaceholderEntry[] = [];

/**
 * The classes a caller wrote for the old one-line input (`h-7 px-2 font-mono…`): a fixed
 * height would clip the toolbar, and the rich view sets its own type. Width and margins stay.
 */
const layoutOnly = (className?: string) =>
  className
    ?.split(/\s+/)
    .filter((c) => !/^(min-h-|max-h-|h-|p[xytblr]?-|font-|text-|rounded)/.test(c))
    .join(" ");

/**
 * A click in the text, not on a control of the field. A field placed in a `<label>` (a module's
 * `<label>{name}<MiniMessageInput/></label>`) would otherwise have the browser forward that click
 * to the label's first control, the toolbar's Bold button: each click in the text toggled bold.
 * Cancelling the click cancels that forwarding; the caret is placed on mousedown, before it.
 */
const keepClickInText = (event: MouseEvent) => {
  const target = event.target as Element | null;
  if (!target?.closest("button, a, input, select, textarea")) event.preventDefault();
};

/**
 * A MiniMessage text field wherever the editor does not know the text's use: the rich
 * editor, its toolbar shown while the field is edited. Module views get it too (SDK
 * `MiniMessageInput`).
 */
export function MiniMessageField({
  value,
  onChange,
  entries = NO_ENTRIES,
  multiline,
  rows,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: MiniMessageFieldProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: cancels a label's forwarding, adds no action
    <div style={{ display: "contents" }} onClick={keepClickInText}>
      <MmEditor
        value={value}
        onChange={onChange}
        profile={multiline ? CHAT : TEXT_LINE}
        entries={entries}
        toolbar="focus"
        minHeight={multiline ? `${Math.max(2, rows ?? 3) * 20 + 16}px` : "0"}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={layoutOnly(className)}
      />
    </div>
  );
}
