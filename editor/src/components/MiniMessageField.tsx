import { MiniMessageInline } from "@/lib/MiniMessageInline";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { useTranslation } from "react-i18next";
import { RevealField } from "./RevealField";

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

/**
 * The one behaviour of a MiniMessage text field: rendered until clicked, then the raw source
 * with the live rendering below it ({@link RevealField}). Used wherever a text supports
 * MiniMessage, module views included (SDK `MiniMessageInput`).
 */
export function MiniMessageField({
  value,
  onChange,
  entries = [],
  multiline,
  rows,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: MiniMessageFieldProps) {
  const { t } = useTranslation();
  return (
    <RevealField
      value={value}
      onChange={onChange}
      entries={entries}
      multiline={multiline}
      rows={rows}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      facade={<MiniMessageInline source={value} />}
      preview={
        value.trim() ? (
          <div className="mt-1 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
            <span className="mr-2 text-[9px] uppercase text-[var(--text-faint)]">
              {t("menuProperties.preview")}
            </span>
            <MiniMessageInline
              source={value}
              className={multiline ? "whitespace-pre-wrap text-xs" : "text-xs"}
            />
          </div>
        ) : null
      }
    />
  );
}
