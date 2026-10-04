import { Button } from "@/components/ui/button";
import { ChangeList, type ChangeSet } from "@/components/ui/change-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ProjectVersionContent,
  type ProjectVersionSummary,
  listProjectVersions,
  readProjectVersion,
} from "@/lib/api/projectVersions";
import { useAccountStore } from "@/state/accountStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { adoptDiskIntoProject, projectTree } from "./saveProjectToDisk";

/**
 * Remplace le contenu texte du brouillon par celui de la Version. Rien n'est
 * publié : l'utilisateur publie ensuite normalement (compare-and-swap compris).
 * Les binaires (images) restent ceux du brouillon — la Version n'en garde que
 * l'empreinte.
 */
export function restoreVersionIntoDraft(projectId: string, version: ProjectVersionContent) {
  const { account, replaceProject } = useAccountStore.getState();
  const project = account.projects.find((p) => p.id === projectId);
  if (!project) throw new Error("project_unavailable");
  const files = Object.fromEntries(version.files.map((f) => [f.path, f.content]));
  const removed = Object.keys(projectTree(project)).filter((path) => !(path in files));
  replaceProject(adoptDiskIntoProject(project, files, removed));
}

const textTree = (version: ProjectVersionContent | null) =>
  Object.fromEntries((version?.files ?? []).map((f) => [f.path, f.content]));
const binaryTree = (version: ProjectVersionContent | null) =>
  Object.fromEntries(
    (version?.binaries ?? []).map((b) => [b.path, { hash: b.hash, size: b.size }]),
  );

/** Ce qu'une Version a changé par rapport à la précédente (vide → tout est ajouté). */
export function versionChangeSet(
  version: ProjectVersionContent,
  previous: ProjectVersionContent | null,
): ChangeSet {
  return {
    before: textTree(previous),
    after: textTree(version),
    binaryBefore: binaryTree(previous),
    binaryAfter: binaryTree(version),
  };
}

const PREVIEW_PATHS = 3;

/**
 * Onglet Historique du workspace : les Versions du Project serveur, la plus
 * récente d'abord (ADR `snapshot-mirror-and-backend-history`, décision 6). Une
 * Version signée vient d'un déploiement depuis l'éditeur ; sans auteur, c'est le
 * serveur qui a rechargé des fichiers modifiés à la main.
 */
export function ProjectHistory({ projectId, active }: { projectId: string; active: boolean }) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<ProjectVersionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<ProjectVersionSummary | null>(null);

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

  // Recharger à chaque retour sur l'onglet : un déploiement a pu passer entre-temps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on réagit à l'activation, pas à `load`.
  useEffect(() => {
    if (active) void load();
  }, [active, projectId]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-mut)]">{t("versions.hint")}</p>
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
          {loading ? t("versions.loading") : t("versions.refresh")}
        </Button>
      </div>
      {failed ? <p className="text-sm text-[var(--danger)]">{t("versions.failed")}</p> : null}
      {versions?.length === 0 ? (
        <p className="text-sm text-[var(--text-faint)]">{t("versions.empty")}</p>
      ) : null}
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {versions?.map((version, index) => (
          <li key={version.id} className="card flex items-center justify-between gap-3 p-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                {new Date(version.createdAt).toLocaleString()}
                <span className={`badge ${version.author ? "badge-sage" : "badge-amber"}`}>
                  {version.author ? t("versions.kindDeploy") : t("versions.kindServer")}
                </span>
                {index === 0 ? <span className="badge">{t("versions.current")}</span> : null}
              </span>
              <span className="truncate text-xs text-[var(--text-mut)]">
                {version.author
                  ? t("versions.deployedBy", { name: version.author.name })
                  : t("versions.byServer")}{" "}
                · {t("versions.changed", { count: version.changed.length })}
              </span>
              {version.changed.length > 0 ? (
                <span className="truncate font-mono text-[11px] text-[var(--text-faint)]">
                  {version.changed.slice(0, PREVIEW_PATHS).join(", ")}
                  {version.changed.length > PREVIEW_PATHS
                    ? ` +${version.changed.length - PREVIEW_PATHS}`
                    : ""}
                </span>
              ) : null}
            </span>
            <Button size="sm" variant="outline" onClick={() => setOpened(version)}>
              {t("versions.view")}
            </Button>
          </li>
        ))}
      </ul>
      <VersionDiffDialog projectId={projectId} version={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

/** Les diffs d'une Version, puis « repartir de cette version » dans le brouillon. */
export function VersionDiffDialog({
  projectId,
  version,
  onClose,
}: {
  projectId: string;
  version: ProjectVersionSummary | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<{
    version: ProjectVersionContent;
    changes: ChangeSet;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const versionId = version?.id;

  useEffect(() => {
    setContent(null);
    setFailed(false);
    if (!versionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const read = await readProjectVersion(projectId, versionId);
        const previous = read.previousId
          ? await readProjectVersion(projectId, read.previousId)
          : null;
        if (!cancelled) setContent({ version: read, changes: versionChangeSet(read, previous) });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, versionId]);

  const restore = () => {
    if (!content) return;
    setBusy(true);
    try {
      restoreVersionIntoDraft(projectId, content.version);
      toast.success(t("versions.restored"));
      onClose();
    } catch {
      toast.error(t("versions.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={version !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader className="pr-6">
          <DialogTitle>
            {version
              ? t("versions.diffTitle", { date: new Date(version.createdAt).toLocaleString() })
              : null}
          </DialogTitle>
          <DialogDescription>
            {version?.author
              ? t("versions.deployedBy", { name: version.author.name })
              : t("versions.byServer")}
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="text-sm text-[var(--danger)]">{t("versions.failed")}</p>
        ) : content ? (
          <ChangeList
            {...content.changes}
            beforeLabel={t("versions.before")}
            afterLabel={t("versions.after")}
            className="min-h-0 flex-1 overflow-y-auto"
          />
        ) : (
          <p className="text-sm text-[var(--text-mut)]">{t("versions.loading")}</p>
        )}
        <DialogFooter className="items-center gap-2">
          <p className="mr-auto text-xs text-[var(--text-faint)]">{t("versions.restoreHint")}</p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            {t("save.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!content || busy}
            onClick={restore}
          >
            {t("versions.restore")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
