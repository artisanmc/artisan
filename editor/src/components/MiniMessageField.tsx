import { CHAT, TEXT_LINE } from "@/lib/mm/profiles";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
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
    <MmEditor
      value={value}
      onChange={onChange}
      profile={multiline ? CHAT : TEXT_LINE}
      entries={entries}
      toolbar="focus"
      minHeight={multiline ? `${Math.max(2, rows ?? 3) * 20 + 16}px` : "0"}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
    />
  );
}
