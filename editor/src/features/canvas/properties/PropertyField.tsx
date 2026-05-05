import { Input } from "@/components/ui/input";

interface PropertyFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  multiline?: boolean;
}

export function PropertyField({
  label,
  value,
  placeholder,
  onChange,
  multiline,
}: PropertyFieldProps) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-zinc-500">{label}</div>
      {multiline ? (
        <textarea
          className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      ) : (
        <Input
          value={value}
          placeholder={placeholder}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      )}
    </div>
  );
}
