import { Input } from "@/components/ui/input";

interface PropertyFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  multiline?: boolean;
  type?: "text" | "number";
}

export function PropertyField({
  label,
  value,
  placeholder,
  onChange,
  multiline,
  type,
}: PropertyFieldProps) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">{label}</div>
      {multiline ? (
        <textarea
          className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2 font-mono text-xs"
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      ) : (
        <Input
          type={type}
          min={type === "number" ? 0 : undefined}
          value={value}
          placeholder={placeholder}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      )}
    </div>
  );
}
