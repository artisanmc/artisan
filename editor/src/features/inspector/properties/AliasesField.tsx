import { X } from "lucide-react";
import { useRef, useState } from "react";
import { FieldLabel } from "../layout";

interface AliasesFieldProps {
  label: string;
  aliases: string[];
  onChange: (aliases: string[]) => void;
}

function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function AliasesField({ label, aliases, onChange }: AliasesFieldProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const value = normalise(input);
    if (!value || aliases.includes(value)) return;
    onChange([...aliases, value]);
    setInput("");
  }

  function remove(alias: string) {
    onChange(aliases.filter((a) => a !== alias));
  }

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: convenience click that focuses the inner <input>, itself reachable with Tab; the container has no action of its own */}
      <div
        className="flex min-h-[34px] w-full cursor-text flex-wrap items-center gap-1 rounded-[var(--r-xs)] border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-1 focus-within:border-[var(--brand-line)] focus-within:shadow-[var(--ring-brand)]"
        onClick={() => inputRef.current?.focus()}
      >
        {aliases.map((alias) => (
          <span
            key={alias}
            className="flex items-center gap-0.5 rounded bg-[var(--surface-raised-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-mut)]"
          >
            {alias}
            <button
              type="button"
              aria-label={`remove ${alias}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(alias);
              }}
              className="text-[var(--text-faint)] hover:text-[var(--text)]"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          placeholder={aliases.length === 0 ? "alias…" : ""}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          className="min-w-16 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-faint)]"
        />
      </div>
    </div>
  );
}
