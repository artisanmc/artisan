import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cx";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";

export interface PlaceholderInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Pre-computed entries — the caller passes `compute(project, location)`. */
  entries: PlaceholderEntry[];
  multiline?: boolean;
  placeholder?: string;
  /** Default true. Set false on fields where the hint would be redundant. */
  showHint?: boolean;
  rows?: number;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Merged after the design-system `.input` / `.textarea` base class. */
  className?: string;
}

/**
 * Text input with `{`-triggered placeholder autocomplete. The caller owns
 * the project→entries computation (via the PlaceholderCatalog) so this stays
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
  autoFocus,
  onFocus,
  onBlur,
  className,
}: PlaceholderInputProps) {
  const { t } = useTranslation();
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const rowId = (path: string) => `${reactId}-row-${encodeURIComponent(path)}`;

  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  // Popup position in fixed viewport coordinates.
  const [popupPos, setPopupPos] = useState({ left: 0, top: 0 });
  // Position of the caret at the moment `{` was typed (i.e. the char right
  // after the opening brace). anchorPos === 0 means "not set".
  const [anchorPos, setAnchorPos] = useState(0);

  const filtered = entries.filter((e) =>
    e.path.toLowerCase().includes(query.toLowerCase()),
  );

  // Close on outside click. The popup is portaled to document.body so it is
  // no longer a DOM child of wrapperRef — we must check both refs separately.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);

    const caretPos = (e.target as HTMLInputElement).selectionStart ?? next.length;

    if (!open) {
      // Check if the new value has an open `{...` fragment at or before the caret
      // with no closing `}` or whitespace between the `{` and the caret.
      const head = next.slice(0, caretPos);
      const lastBrace = head.lastIndexOf("{");
      if (lastBrace !== -1) {
        const tail = head.slice(lastBrace + 1);
        // Only open if no `}` or whitespace in the tail (fresh open fragment).
        if (!/[}\s]/.test(tail)) {
          const anchor = lastBrace + 1; // caret position right after the `{`
          setOpen(true);
          setAnchorPos(anchor);
          setQuery(tail);
          setHighlight(0);
          // Anchor at the field's left edge, below it — a caret-anchored popup
          // walks off the viewport when `{` is typed near the end of a long
          // value. Clamp so the popup (min-width 260px) stays on screen.
          const rect = e.target.getBoundingClientRect();
          setPopupPos({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)),
            top: rect.bottom + 2,
          });
        }
      }
    } else {
      // The `{` is at anchorPos - 1. If it's gone, close.
      if (next[anchorPos - 1] !== "{") {
        setOpen(false);
        return;
      }
      // Derive query from the anchor to the current caret.
      const tail = next.slice(anchorPos, caretPos);
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
    // Replace from anchorPos - 1 (the `{`) through the current caret with
    // `{path}`. Then close.
    const caret = el.selectionStart ?? value.length;
    const bracePos = anchorPos - 1; // position of the `{` in value
    if (bracePos < 0 || value[bracePos] !== "{") return;
    const newValue = value.slice(0, bracePos) + `{${path}}` + value.slice(caret);
    onChange(newValue);
    setOpen(false);
    setQuery("");
  };

  const commonProps = {
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onFocus,
    onBlur,
    autoFocus,
    placeholder,
    role: "combobox" as const,
    "aria-expanded": open,
    "aria-controls": listboxId,
    "aria-activedescendant":
      open && filtered[highlight] ? rowId(filtered[highlight].path) : undefined,
  };

  const popup = open
    ? createPortal(
        <ul
          ref={popupRef}
          role="listbox"
          id={listboxId}
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
                id={rowId(e.path)}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(ev) => {
                  ev.preventDefault(); // don't blur the input
                  insertAtCaret(e.path);
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
        </ul>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapperRef}>
      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          rows={rows}
          className={cn("textarea", className)}
          {...commonProps}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          className={cn("input", className)}
          {...commonProps}
        />
      )}

      {popup}

      {showHint && !open && entries.length > 0 && (
        <p className="placeholder-hint text-[11px] text-[var(--text-faint)]">
          {t("placeholderInput.hint")}
        </p>
      )}
    </div>
  );
}
