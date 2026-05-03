import type { DataSource, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { ValueInput } from "./ValueInput";

interface ValueEditorProps {
  packId: PackId;
  source: DataSource;
}

export function ValueEditor({ packId, source }: ValueEditorProps) {
  const setValue = useAccountStore((s) => s.setPackDataSourceValue);
  return (
    <ValueInput
      type={source.type}
      value={source.value}
      onChange={(value) => setValue({ packId, id: source.id, value })}
    />
  );
}
