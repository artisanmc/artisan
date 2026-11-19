import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { visitDataSourceLTexts } from "@/domain/i18nSites";
import { shippedDataFiles } from "@/domain/shippedData";
import type { DataSource, Project } from "@/domain/types";
import { FileHistory } from "@/features/project/FileHistory";
import { adoptDiskIntoProject, projectTree } from "@/features/project/saveProjectToDisk";
import { YAML_EXT, yamlPathOnDisk } from "@/lib/yamlFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { parse } from "yaml";

/**
 * A Project data source's file (`data/<id>.yml`: a module's Config screen's table), under the
 * name the disk gives it. A per-row source is a folder of files: no single file to show.
 */
export function dataSourceRelPath(project: Project, source: DataSource): string | null {
  if (source.shape === "table" && source.granularity === "row") return null;
  return yamlPathOnDisk(
    `data/${source.id}${YAML_EXT}`,
    useProjectBaselineStore.getState().get(project.id) ?? {},
  );
}

/**
 * The file as the working copy says it: what the next Deploy writes; else, the source unchanged,
 * what the module ships (`originals/data/…`, served while the owner has no copy:
 * `shippedData.ts`, which leaves it out of the written tree).
 */
export function sourceFileText(
  project: Project,
  relPath: string,
  disk: Record<string, string> | undefined,
): string {
  const written = projectTree(project)[relPath];
  if (written !== undefined) return written;
  const shipped = disk ? shippedDataFiles(Object.keys(disk)).get(relPath) : undefined;
  return (shipped !== undefined ? disk?.[shipped] : undefined) ?? "";
}

/**
 * Parses an edited source file against the working copy: the source it describes and its
 * texts, every language (the default one from the file, the others from `lang/<lang>.yml`).
 * Null when the text is not YAML or no longer describes the source.
 */
export function sourceFromText(
  project: Project,
  source: DataSource,
  relPath: string,
  text: string,
): { source: DataSource; texts: Record<string, Record<string, string>> } | null {
  try {
    parse(text);
  } catch {
    return null;
  }
  let adopted: Project;
  try {
    adopted = adoptDiskIntoProject(project, { [relPath]: text }, []);
  } catch {
    return null;
  }
  const next = adopted.dataSources.find((d) => d.id === source.id);
  if (!next || next.shape !== source.shape) return null;
  const texts: Record<string, Record<string, string>> = {};
  for (const site of visitDataSourceLTexts(adopted, next)) {
    const entry = adopted.i18nKeys[site.lText.key];
    if (entry) texts[site.lText.key] = entry;
  }
  return { source: next, texts };
}

/**
 * A data source's file as text, on a module's Config screen or a Project's own source page.
 * Unlike a Document's YAML (`DocumentYamlView`, a live write), it edits the working copy like
 * the form beside it: Apply goes to the draft and reaches the server with Deploy (ADR
 * `module-config-screens`, amendment 2026-11-19). Deploy patches the changed values into the
 * server's file (`patchYamlText`): its comments stay, a comment typed here does not.
 */
export function SourceYamlView({
  project,
  source,
  relPath,
}: {
  project: Project;
  source: DataSource;
  relPath: string;
}) {
  const { t } = useTranslation();
  const replaceSourceFromFile = useProjectsStore((s) => s.replaceSourceFromFile);
  const [base, setBase] = useState(() =>
    sourceFileText(project, relPath, useProjectBaselineStore.getState().get(project.id)),
  );
  const [text, setText] = useState(base);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const current =
      useProjectsStore.getState().openProjects.projects.find((p) => p.id === project.id) ?? project;
    const parsed = sourceFromText(current, source, relPath, text);
    if (!parsed) {
      setError(t("sourceYaml.invalid"));
      return;
    }
    setError(null);
    replaceSourceFromFile({ projectId: project.id, ...parsed });
    setBase(text);
    toast.success(t("sourceYaml.applied"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3" data-testid="source-yaml">
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate text-[11px] text-[var(--text-mut)]">{relPath}</code>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={text === base}
          onClick={apply}
        >
          {t("sourceYaml.apply")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border-soft)] bg-[var(--surface)]">
        <YamlCodeEditor value={text} ariaLabel={relPath} onChange={setText} />
      </div>
      {error ? (
        <p className="text-[11px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-[11px] text-[var(--text-faint)]">{t("sourceYaml.hint")}</p>
      <FileHistory projectId={project.id} path={relPath} onRestore={setText} />
    </div>
  );
}
