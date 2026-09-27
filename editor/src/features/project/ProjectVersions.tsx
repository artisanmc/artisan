import { Button } from "@/components/ui/button";
import {
  type ProjectVersionSummary,
  listProjectVersions,
  readProjectVersion,
} from "@/lib/api/projectVersions";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { adoptDiskIntoProject, projectTree } from "./saveProjectToDisk";

/**
 * Les Versions du Project entier (ADR `snapshot-mirror-and-backend-history`,
 * décision 6). Restaurer remplace le contenu de TON brouillon par celui de la
 * Version ; rien n'est publié tant que tu ne le fais pas.
 */
export function ProjectVersions({
  projectId,
  onRestored,
}: {
  projectId: string;
  onRestored: () => void;
}) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<ProjectVersionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      setVersions(await listProjectVersions(projectId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const restore = async (versionId: string) => {
    setLoading(true);
    try {
      const version = await readProjectVersion(projectId, versionId);
      const { account, replaceProject } = useAccountStore.getState();
      const project = account.projects.find((p) => p.id === projectId);
      if (!project) throw new Error("project_unavailable");
      const files = Object.fromEntries(version.files.map((f) => [f.path, f.content]));
      const removed = Object.keys(projectTree(project)).filter((path) => !(path in files));
      replaceProject(adoptDiskIntoProject(project, files, removed));
      toast.success(t("versions.restored"));
      onRestored();
    } catch {
      toast.error(t("versions.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="field-label">{t("versions.title")}</h3>
      {versions === null ? (
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
          {loading ? t("versions.loading") : t("versions.show")}
        </Button>
      ) : versions.length === 0 ? (
        <p className="text-xs text-[var(--text-faint)]">{t("versions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {versions.map((version, index) => (
            <li key={version.id} className="card flex items-center justify-between gap-2 p-2">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm">{new Date(version.createdAt).toLocaleString()}</span>
                <span className="truncate text-xs text-[var(--text-mut)]">
                  {version.author?.name ?? t("versions.byServer")} ·{" "}
                  {t("versions.changed", { count: version.changed.length })}
                </span>
              </span>
              {index === 0 ? (
                <span className="text-xs text-[var(--text-faint)]">{t("versions.current")}</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => void restore(version.id)}
                >
                  {t("versions.restore")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {failed ? <p className="text-xs text-[var(--danger)]">{t("versions.failed")}</p> : null}
      <p className="text-xs text-[var(--text-faint)]">{t("versions.hint")}</p>
    </section>
  );
}
