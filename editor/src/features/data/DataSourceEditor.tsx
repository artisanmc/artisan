import { Badge } from "@/components/ui/badge";
import { findDataModel } from "@/domain/dataModels";
import type { DataSource, ModelField, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { ItemTemplatesSection, packSourceToTemplatable } from "./ItemTemplatesSection";

interface DataSourceEditorProps {
  projectId: ProjectId;
  source: DataSource;
}

function fieldKindLabel(f: ModelField): string {
  const t = f.type;
  if (t.kind === "list") return `list<${t.of.kind}>`;
  return t.kind;
}

/**
 * Project-source detail. The YAML pane died with the declared-schema refactor
 * (ADR `project-sources-and-data-models`): editing is form-only, and the row
 * form ships with the authoring-UI phase. Until then this shows the declared
 * shape read-only + the Sets section (unchanged).
 */
export function DataSourceEditor({ projectId, source }: DataSourceEditorProps) {
  const { t } = useTranslation();
  const renameDataSource = useAccountStore((s) => s.renameProjectDataSource);
  const removeDataSource = useAccountStore((s) => s.removeProjectDataSource);
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  if (!pack) return null;

  const fields =
    source.shape === "table"
      ? (findDataModel(pack, source.modelId)?.fields ?? [])
      : source.fields;

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

      <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border-soft)] p-3">
        <div className="eyebrow mb-2">{t("dataSources.schemaTitle")}</div>
        {fields.length === 0 ? (
          <p className="text-[11px] text-[var(--text-faint)]">{t("dataSources.noSchema")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {fields.map((f) => (
              <li key={f.name} className="flex items-center gap-2 font-mono text-[12px]">
                <span className="text-[var(--text)]">{f.name}</span>
                <span className="text-[var(--text-faint)]">{fieldKindLabel(f)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Item sets over PROJECT data — same tooling as server sources. */}
      <div className="shrink-0 border-t border-[var(--border-soft)] pt-2">
        <ItemTemplatesSection projectId={projectId} source={packSourceToTemplatable(pack, source)} />
      </div>
    </div>
  );
}
