import type { DataSource, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { SchemaEditor } from "./SchemaEditor";
import { ValueEditor } from "./ValueEditor";

interface DataSourceEditorProps {
  packId: PackId;
  source: DataSource;
}

export function DataSourceEditor({ packId, source }: DataSourceEditorProps) {
  const { t } = useTranslation();
  const renameDataSource = useAccountStore((s) => s.renamePackDataSource);
  const removeDataSource = useAccountStore((s) => s.removePackDataSource);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <input
          type="text"
          value={source.name}
          onChange={(e) => renameDataSource({ packId, id: source.id, newName: e.target.value })}
          className="bg-transparent text-lg font-semibold text-zinc-100 outline-none focus:border-b focus:border-zinc-500"
        />
        <button
          type="button"
          onClick={() => removeDataSource({ packId, id: source.id })}
          className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
        >
          {t("dataSources.remove")}
        </button>
      </header>
      <SchemaEditor packId={packId} source={source} />
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
          {t("dataSources.values")}
        </div>
        <ValueEditor packId={packId} source={source} />
      </div>
    </div>
  );
}
