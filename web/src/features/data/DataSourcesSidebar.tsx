import type { DataSourceId, Pack } from "@/domain/types";
import { parseConnectorYaml } from "@/lib/connectors/parser";
import { useAccountStore } from "@/state/accountStore";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { summarizeFieldType } from "./helpers";

interface DataSourcesSidebarProps {
  pack: Pack;
  selectedId: DataSourceId | null;
  onSelect: (id: DataSourceId | null) => void;
}

export function DataSourcesSidebar({ pack, selectedId, onSelect }: DataSourcesSidebarProps) {
  const { t } = useTranslation();
  const addPackDataSource = useAccountStore((s) => s.addPackDataSource);
  const addImportedConnector = useAccountStore((s) => s.addImportedConnector);
  const removeImportedConnector = useAccountStore((s) => s.removeImportedConnector);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    let added = 0;
    for (const file of Array.from(files)) {
      const text = await file.text();
      const result = parseConnectorYaml(text);
      if (result.ok) {
        addImportedConnector({ packId: pack.id, spec: result.spec });
        added++;
      } else {
        toast.error(t("dataSources.importError", { file: file.name, error: result.error }));
      }
    }
    if (added > 0) {
      toast.success(t("dataSources.importSuccess", { count: added }));
    }
  };

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
              <li
                key={c.ref}
                className="group flex items-center gap-1 px-2 py-1 text-[12px] text-zinc-400"
              >
                <span>🔌</span>
                <span className="flex-1 truncate font-mono">{c.ref}</span>
                <button
                  type="button"
                  onClick={() => removeImportedConnector({ packId: pack.id, ref: c.ref })}
                  title={t("dataSources.removeConnector")}
                  className="flex h-5 w-5 items-center justify-center rounded text-[12px] text-zinc-500 opacity-100 hover:bg-zinc-800 hover:text-rose-300 lg:opacity-0 lg:group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 self-start rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          {t("dataSources.importConnectors")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".yaml,.yml"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            // reset so the same file can be re-imported
            e.target.value = "";
          }}
        />
      </section>
    </div>
  );
}
