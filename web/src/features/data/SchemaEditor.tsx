import type { DataSource, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { FieldTypeBuilder } from "./FieldTypeBuilder";

interface SchemaEditorProps {
  packId: PackId;
  source: DataSource;
}

export function SchemaEditor({ packId, source }: SchemaEditorProps) {
  const { t } = useTranslation();
  const setSchema = useAccountStore((s) => s.setPackDataSourceSchema);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
      <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
        {t("dataSources.schema")}
      </div>
      <FieldTypeBuilder
        type={source.type}
        onChange={(type) => setSchema({ packId, id: source.id, type })}
      />
    </div>
  );
}
