import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCaretCoordinates } from "@/lib/caretCoordinates";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";

export interface PlaceholderInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Pre-computed entries — the caller passes `compute(pack, location)`. */
  entries: PlaceholderEntry[];
  multiline?: boolean;
  placeholder?: string;
  /** Default true. Set false on fields where the hint would be redundant. */
  showHint?: boolean;
  rows?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Text input with `{`-triggered placeholder autocomplete. The caller owns
 * the pack→entries computation (via the PlaceholderCatalog) so this stays
 * domain-agnostic and reusable.
 */
export function PlaceholderInput({
  value,
  onChange,
  entries,
  multiline,
  placeholder,
  showHint = true,
  rows,
  onFocus,
  onBlur,
}: PlaceholderInputProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [popupPos, setPopupPos] = useState({ left: 0, top: 0 });

  const filtered = entries.filter((e) =>
    e.path.toLowerCase().includes(query.toLowerCase()),
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);

    if (!open) {
      // Check if the new value has an open `{...` fragment at or before the caret
      // with no closing `}` or whitespace between the `{` and the caret.
      const caretPos = (e.target as HTMLInputElement).selectionStart ?? next.length;
      const head = next.slice(0, caretPos);
      const lastBrace = head.lastIndexOf("{");
      if (lastBrace !== -1) {
        const tail = head.slice(lastBrace + 1);
        // Only open if no `}` or whitespace in the tail (fresh open fragment).
        if (!/[}\s]/.test(tail)) {
          setOpen(true);
          setQuery(tail);
          setHighlight(0);
          requestAnimationFrame(() => {
            const el = ref.current;
            if (!el) return;
            const c = getCaretCoordinates(el, el.selectionStart ?? next.length);
            setPopupPos({ left: c.left, top: c.top + c.height + 2 });
          });
        }
      }
    } else {
      const lastBrace = next.lastIndexOf("{");
      if (lastBrace === -1) {
        // Backspaced past the original `{`.
        setOpen(false);
        return;
      }
      const tail = next.slice(lastBrace + 1);
      // Close if the user added a closing brace, a space, or a newline.
      if (/[}\s]/.test(tail)) {
        setOpen(false);
        return;
      }
      setQuery(tail);
      setHighlight(0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }

    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[highlight];
      if (!pick) {
        setOpen(false);
        return;
      }
      insertAtCaret(pick.path);
    }
  };

  const insertAtCaret = (path: string) => {
    const el = ref.current;
    if (!el) return;
    // Replace from the most recent `{` (and any partial query already typed) up
    // to the caret with `{path}`. Then close.
    const caret = el.selectionStart ?? value.length;
    const head = value.slice(0, caret);
    const lastBrace = head.lastIndexOf("{");
    if (lastBrace === -1) return;
    const newValue = value.slice(0, lastBrace) + `{${path}}` + value.slice(caret);
    onChange(newValue);
    setOpen(false);
    setQuery("");
  };

  const handleRowClick = (path: string) => {
    insertAtCaret(path);
  };

  const commonProps = {
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onFocus,
    onBlur,
    placeholder,
    role: "combobox" as const,
    "aria-expanded": open,
    "aria-controls": "placeholder-listbox",
    "aria-activedescendant":
      open && filtered[highlight] ? `placeholder-row-${filtered[highlight].path}` : undefined,
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          rows={rows}
          {...commonProps}
        />
      ) : (
        <input ref={ref as React.RefObject<HTMLInputElement>} {...commonProps} />
      )}

      {open && (
        <ul
          role="listbox"
          id="placeholder-listbox"
          className="placeholder-popup"
          style={{ left: popupPos.left, top: popupPos.top }}
        >
          {filtered.length === 0 ? (
            <li className="empty" role="option" aria-selected={false}>
              {entries.length === 0
                ? t("placeholderInput.emptyContext")
                : t("placeholderInput.emptyMatch", { query })}
            </li>
          ) : (
            filtered.map((e, i) => (
              <li
                key={e.path}
                id={`placeholder-row-${e.path}`}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(ev) => {
                  ev.preventDefault(); // don't blur the input
                  handleRowClick(e.path);
                }}
              >
                <span className="name">{e.path}</span>
                <span className="type">{e.type}</span>
                {e.sample !== null ? (
                  <span className="sample">{e.sample}</span>
                ) : (
                  <span className="sample">—</span>
                )}
                <span className="origin">{e.origin}</span>
              </li>
            ))
          )}
        </ul>
      )}

      {showHint && !open && entries.length > 0 && (
        <p className="placeholder-hint text-[11px] text-[var(--ink-faint)]">
          {t("placeholderInput.hint")}
        </p>
      )}
    </div>
  );
}
