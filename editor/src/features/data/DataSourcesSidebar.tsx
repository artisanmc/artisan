import type { DataSourceId, Project } from "@/domain/types";
import { parseConnectorYaml } from "@/lib/connectors/parser";
import { useAccountStore } from "@/state/accountStore";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ServerSourcesSection } from "./ServerSourcesSection";
import { summarizeFieldType } from "./helpers";

interface DataSourcesSidebarProps {
  pack: Project;
  selectedId: DataSourceId | null;
  onSelect: (id: DataSourceId | null) => void;
  selectedServerRef: string | null;
  onSelectServerRef: (ref: string) => void;
}

export function DataSourcesSidebar({
  pack,
  selectedId,
  onSelect,
  selectedServerRef,
  onSelectServerRef,
}: DataSourcesSidebarProps) {
  const { t } = useTranslation();
  const addProjectDataSource = useAccountStore((s) => s.addProjectDataSource);
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
        addImportedConnector({ projectId: pack.id, spec: result.spec });
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
    <div className="flex flex-1 flex-col gap-4 p-3">
      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
          {t("dataSources.sectionProject")}
        </div>
        <ul className="flex flex-col gap-1">
          {(pack.dataSources ?? []).map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onSelect(d.id)}
                className={
                  selectedId === d.id
                    ? "flex w-full items-center gap-1 rounded bg-[var(--surface-raised-2)] px-2 py-1 text-left text-[12px]"
                    : "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-[var(--text-mut)] hover:bg-[var(--surface-raised)]"
                }
              >
                <span>{d.type.kind === "list" ? "🗂" : "📦"}</span>
                <span className="truncate">{d.name}</span>
                <span className="ml-auto text-[9px] text-[var(--text-faint)]">
                  {summarizeFieldType(d.type)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => {
              addProjectDataSource({ projectId: pack.id });
            }}
            className="w-full rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("dataSources.add")}
          </button>
        </div>
      </section>

      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
          {t("dataSources.sectionConnectors")}
        </div>
        {(pack.importedConnectors ?? []).length === 0 ? (
          <div className="rounded border border-dashed border-[var(--border-soft)] bg-[var(--surface-raised)]/40 px-2 py-2 text-[11px] text-[var(--text-faint)]">
            {t("dataSources.noConnectors")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {(pack.importedConnectors ?? []).map((c) => (
              <li
                key={c.ref}
                className="group flex items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-mut)]"
              >
                <span>🔌</span>
                <span className="flex-1 truncate font-mono">{c.ref}</span>
                <button
                  type="button"
                  onClick={() => removeImportedConnector({ projectId: pack.id, ref: c.ref })}
                  title={t("dataSources.removeConnector")}
                  className="flex h-5 w-5 items-center justify-center rounded text-[12px] text-[var(--text-faint)] opacity-100 hover:bg-[var(--surface-raised-2)] hover:text-rose-300 lg:opacity-0 lg:group-hover:opacity-100"
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
          className="mt-2 self-start rounded border border-[var(--border)] border-dashed px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
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

      <ServerSourcesSection selectedRef={selectedServerRef} onSelect={onSelectServerRef} />
    </div>
  );
}
