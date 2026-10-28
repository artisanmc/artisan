import { Input } from "@/components/ui/input";
import { FieldLabel } from "../layout";

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
      <FieldLabel>{label}</FieldLabel>
      {multiline ? (
        <textarea
          className="textarea min-h-0 rounded-[var(--r-xs)] px-2.5 py-2 text-[13px]"
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      ) : (
        <Input
          className="h-[34px] rounded-[var(--r-xs)] px-2.5 py-0 text-[13px]"
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
