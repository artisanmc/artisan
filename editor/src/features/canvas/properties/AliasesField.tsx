import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { useState } from "react";

interface AliasesFieldProps {
  label: string;
  aliases: string[];
  onChange: (aliases: string[]) => void;
}

function normalise(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export function AliasesField({ label, aliases, onChange }: AliasesFieldProps) {
  const [input, setInput] = useState("");

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
      <div className="mb-1 text-[10px] uppercase text-zinc-500">{label}</div>
      <div className="flex flex-wrap gap-1 mb-1">
        {aliases.map((alias) => (
          <span
            key={alias}
            className="flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300"
          >
            {alias}
            <button
              type="button"
              aria-label={`remove ${alias}`}
              onClick={() => remove(alias)}
              className="text-zinc-500 hover:text-zinc-200"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={input}
        placeholder="alias…"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}
