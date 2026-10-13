import { Badge } from "@/components/ui/badge";
import type { DataSource, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelFieldsEditor } from "./ModelFieldsEditor";
import { ConfigValueForm, SourceRowsTable } from "./SourceValueEditor";
import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { yamlErrorsOf } from "@/features/screens/YamlFileEditor";
import { applySourceYaml, sourceYamlFiles, type SourceFile } from "./sourceYaml";
import { cx } from "@/lib/cx";

interface DataSourceEditorProps {
  projectId: ProjectId;
  source: DataSource;
}

/**
 * Project-source detail: schema section (Data model / config fields), then
 * the rows table (table) or the value form (config), then the Sets section.
 * ADR `project-sources-and-data-models`.
 */
export function DataSourceEditor({ projectId, source }: DataSourceEditorProps) {
  const { t } = useTranslation();
  const renameDataSource = useAccountStore((s) => s.renameProjectDataSource);
  const removeDataSource = useAccountStore((s) => s.removeProjectDataSource);
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const [schemaOpen, setSchemaOpen] = useState(true);
  // Two modes on the SAME file (ADR yaml-assisted-editing ⑦/⑧): the data panel
  // and the config screen speak the same language.
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [draft, setDraft] = useState<SourceFile[] | null>(null);
  const [selectedFile, setSelectedFile] = useState("");
  const replaceProject = useAccountStore((s) => s.replaceProject);
  const [nameDraft, setNameDraft] = useState(source.name.toLowerCase());
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(source.name.toLowerCase());
    setNameError(null);
  }, [source.name]);

  // Another source is another file: neither draft nor mode is inherited.
  useEffect(() => {
    setDraft(null);
    setMode("form");
  }, [source.id]);

  if (!project) return null;

  const yamlErrors = draft ? yamlErrorsOf(draft) : [];

  /**
   * Writes the text back into the project. Broken YAML is NOT applied (the
   * domain is not destroyed with it), but the text stays on screen, editable.
   */
  const applyDraft = () => {
    if (!draft || yamlErrors.length > 0) return;
    const next = applySourceYaml(project, draft);
    if (!next) return;
    replaceProject(next);
    // Immediate canonicalisation: the text shown again is what the writer just
    // produced, not the draft.
    const reparsed = next.dataSources.find((d) => String(d.id) === String(source.id));
    setDraft(reparsed ? sourceYamlFiles(next, reparsed) : null);
  };

  const commitName = () => {
    const normalizedName = nameDraft.trim().toLowerCase();
    setNameDraft(normalizedName);
    if (normalizedName === "") {
      setNameError(t("dataSources.nameRequired"));
      return;
    }
    const renamed = renameDataSource({ projectId, id: source.id, newName: normalizedName });
    setNameError(renamed ? null : t("dataSources.nameDuplicate"));
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => {
              setNameDraft(e.target.value.toLowerCase());
              setNameError(null);
            }}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label={t("dataSources.sourceName")}
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? "data-source-name-error" : undefined}
            className="w-full bg-transparent text-lg font-semibold text-[var(--text)] outline-none focus:border-b focus:border-[var(--brand-line)]"
          />
          {nameError ? (
            <p id="data-source-name-error" className="text-[10px] text-[var(--danger)]">
              {nameError}
            </p>
          ) : null}
        </div>
        <Badge>
          {source.shape === "table" ? t("dataSources.shapeTable") : t("dataSources.shapeConfig")}
        </Badge>
        <div className="flex shrink-0 gap-1">
          {(["form", "yaml"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                // The draft NEVER survives a tab change: keeping it would bring back stale
                // text and overwrite the edits made in the form in the meantime.
                if (m === "form") {
                  applyDraft();
                  setDraft(null);
                } else {
                  setDraft(sourceYamlFiles(project, source));
                }
                setMode(m);
              }}
              className={cx("chip h-7 px-3 text-[11px]", mode === m && "is-active")}
            >
              {t(m === "form" ? "screens.modeForm" : "screens.modeYaml")}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(t("dataSources.confirmRemove", { name: source.name }))) return;
            removeDataSource({ projectId, id: source.id });
          }}
          className="shrink-0 whitespace-nowrap rounded px-2 py-1 text-[11px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
        >
          {t("dataSources.remove")}
        </button>
      </header>

      {mode === "yaml" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="source-yaml">
          {(draft ?? []).length > 1 && (
            <select
              className="input h-7 w-auto max-w-full self-start px-2 font-mono text-[11px]"
              value={selectedFile || (draft ?? [])[0]?.path || ""}
              onChange={(e) => setSelectedFile(e.target.value)}
              aria-label={t("screens.yamlFile")}
            >
              {(draft ?? []).map((f) => (
                <option key={f.path} value={f.path}>{f.path}</option>
              ))}
            </select>
          )}
          {(() => {
            const files = draft ?? [];
            const current = files.find((f) => f.path === selectedFile) ?? files[0];
            if (!current) return null;
            const err = yamlErrors.find((e) => e.path === current.path);
            return (
              <>
                <div className="min-h-64 flex-1 overflow-auto rounded border border-[var(--border-soft)] bg-[var(--surface)]">
                  <YamlCodeEditor
                    value={current.content}
                    ariaLabel={current.path}
                    onChange={(next) =>
                      setDraft(files.map((f) => (f.path === current.path ? { ...f, content: next } : f)))
                    }
                  />
                </div>
                {err ? (
                  <p className="text-[11px] text-rose-300" role="alert">
                    {err.line !== null ? `${t("screens.yamlErrorLine", { line: err.line })} — ` : ""}
                    {err.message}
                  </p>
                ) : (
                  <button type="button" onClick={applyDraft} className="btn btn-sm self-start">
                    {t("dataSources.applyYaml")}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      ) : (
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
            <ModelFieldsEditor projectId={projectId} project={project} source={source} />
          ) : null}
        </section>

        <section className="rounded border border-[var(--border-soft)] p-3">
          <div className="eyebrow mb-2">
            {source.shape === "table" ? t("dataSources.rowsTitle") : t("dataSources.valuesTitle")}
          </div>
          {source.shape === "table" ? (
            <SourceRowsTable projectId={projectId} project={project} source={source} />
          ) : (
            <ConfigValueForm projectId={projectId} project={project} source={source} />
          )}
        </section>

        {/* Item sets live at the MENU level — no data-level creation surface. */}
      </div>
      )}
    </div>
  );
}
