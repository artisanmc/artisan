import type { DataSourceId, Pack } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { summarizeFieldType } from "./helpers";

interface DataSourcesSidebarProps {
  pack: Pack;
  selectedId: DataSourceId | null;
  onSelect: (id: DataSourceId | null) => void;
}

export function DataSourcesSidebar({ pack, selectedId, onSelect }: DataSourcesSidebarProps) {
  const { t } = useTranslation();
  const addPackDataSource = useAccountStore((s) => s.addPackDataSource);

  return (
    <div className="flex w-64 flex-col gap-4 border-r border-zinc-800 bg-zinc-950 p-3">
      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          {t("dataSources.sectionPack")}
        </div>
        <ul className="flex flex-col gap-1">
          {pack.dataSources.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onSelect(d.id)}
                className={
                  selectedId === d.id
                    ? "flex w-full items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-left text-[12px]"
                    : "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-zinc-300 hover:bg-zinc-900"
                }
              >
                <span>{d.type.kind === "list" ? "🗂" : "📦"}</span>
                <span className="truncate">{d.name}</span>
                <span className="ml-auto text-[9px] text-zinc-500">
                  {summarizeFieldType(d.type)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => addPackDataSource({ packId: pack.id, kind: "list" })}
            className="flex-1 rounded border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("dataSources.addList")}
          </button>
          <button
            type="button"
            onClick={() => addPackDataSource({ packId: pack.id, kind: "object" })}
            className="flex-1 rounded border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("dataSources.addObject")}
          </button>
        </div>
      </section>

      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          {t("dataSources.sectionConnectors")}
        </div>
        {pack.importedConnectors.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/40 px-2 py-2 text-[11px] text-zinc-500">
            {t("dataSources.noConnectors")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {pack.importedConnectors.map((c) => (
              <li key={c.ref}>
                <div className="flex items-center gap-1 px-2 py-1 text-[12px] text-zinc-400">
                  <span>🔌</span>
                  <span className="truncate font-mono">{c.ref}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
