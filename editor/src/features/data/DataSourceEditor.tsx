import { Badge } from "@/components/ui/badge";
import type { DataSource, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemTemplatesSection, packSourceToTemplatable } from "./ItemTemplatesSection";
import { ModelFieldsEditor } from "./ModelFieldsEditor";
import { ConfigValueForm, SourceRowsTable } from "./SourceValueEditor";

interface DataSourceEditorProps {
  projectId: ProjectId;
  source: DataSource;
}

/**
 * Project-source detail — form-only editing (the YAML pane died with the
 * declared-schema refactor, ADR `project-sources-and-data-models`): schema
 * section (Data model / config fields), then the rows table (table) or the
 * value form (config), then the Sets section (unchanged).
 */
export function DataSourceEditor({ projectId, source }: DataSourceEditorProps) {
  const { t } = useTranslation();
  const renameDataSource = useAccountStore((s) => s.renameProjectDataSource);
  const removeDataSource = useAccountStore((s) => s.removeProjectDataSource);
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const [schemaOpen, setSchemaOpen] = useState(true);
  if (!pack) return null;

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <input
          type="text"
          value={source.name}
          onChange={(e) => renameDataSource({ projectId, id: source.id, newName: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-[var(--text)] outline-none focus:border-b focus:border-[var(--brand-line)]"
        />
        <Badge>
          {source.shape === "table" ? t("dataSources.shapeTable") : t("dataSources.shapeConfig")}
        </Badge>
        <button
          type="button"
          onClick={() => removeDataSource({ projectId, id: source.id })}
          className="shrink-0 rounded px-2 py-1 text-[11px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
        >
          {t("dataSources.remove")}
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        <section className="rounded border border-[var(--border-soft)] p-3">
          <button
            type="button"
            onClick={() => setSchemaOpen((v) => !v)}
            className="eyebrow mb-2 flex items-center gap-1"
            aria-expanded={schemaOpen}
          >
            <span>{schemaOpen ? "▾" : "▸"}</span>
            {t("dataSources.schemaTitle")}
          </button>
          {schemaOpen ? (
            <ModelFieldsEditor projectId={projectId} pack={pack} source={source} />
          ) : null}
        </section>

        <section className="rounded border border-[var(--border-soft)] p-3">
          <div className="eyebrow mb-2">
            {source.shape === "table" ? t("dataSources.rowsTitle") : t("dataSources.valuesTitle")}
          </div>
          {source.shape === "table" ? (
            <SourceRowsTable projectId={projectId} pack={pack} source={source} />
          ) : (
            <ConfigValueForm projectId={projectId} pack={pack} source={source} />
          )}
        </section>

        {/* Item sets over PROJECT data — same tooling as server sources. */}
        {source.shape === "table" ? (
          <section className="border-t border-[var(--border-soft)] pt-2">
            <ItemTemplatesSection
              projectId={projectId}
              source={packSourceToTemplatable(pack, source)}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
