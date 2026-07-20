import type { DataSourceId, Project } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { ServerSourcesSection } from "./ServerSourcesSection";

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
                <span>{d.shape === "table" ? "🗂" : "📦"}</span>
                <span className="truncate">{d.name}</span>
                <span className="ml-auto text-[9px] text-[var(--text-faint)]">
                  {d.shape === "table"
                    ? t("dataSources.shapeTable")
                    : t("dataSources.shapeConfig")}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={() => addProjectDataSource({ projectId: pack.id, shape: "table" })}
            className="flex-1 rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("dataSources.addTable")}
          </button>
          <button
            type="button"
            onClick={() => addProjectDataSource({ projectId: pack.id, shape: "config" })}
            className="flex-1 rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("dataSources.addConfig")}
          </button>
        </div>
      </section>

      <ServerSourcesSection selectedRef={selectedServerRef} onSelect={onSelectServerRef} />
    </div>
  );
}
