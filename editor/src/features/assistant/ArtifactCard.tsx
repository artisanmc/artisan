import { FileDiff, diffStats } from "@/components/ui/file-diff";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { menusOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { MenuPlayPreview } from "@/features/play/MenuPlayPreview";
import { type PersistedDraft, readDraft } from "@/lib/api/projectDrafts";
import { FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Artifact, isProject, menuIdOfPath, projectFromDraftTree } from "./artifacts";

type DraftRead =
  | { status: "loading" }
  | { status: "ready"; draft: PersistedDraft }
  | { status: "failed" };

/** One read per draft and version, shared by the cards of its files. */
const reads = new Map<string, Promise<PersistedDraft>>();

function readOnce(project: string, draftId: string, version: number): Promise<PersistedDraft> {
  const key = `${project}\u0000${draftId}\u0000${version}`;
  let read = reads.get(key);
  if (!read) {
    read = readDraft(project, draftId);
    // A failed read is asked again by the next card or version.
    read.catch(() => reads.delete(key));
    reads.set(key, read);
  }
  return read;
}

/** The draft as its last write in the conversation left it ([version]: that event's seq). */
function useDraft(project: string, draftId: string, version: number): DraftRead {
  const [read, setRead] = useState<DraftRead>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void readOnce(project, draftId, version).then(
      (draft) => !cancelled && setRead({ status: "ready", draft }),
      () => !cancelled && setRead({ status: "failed" }),
    );
    return () => {
      cancelled = true;
    };
  }, [project, draftId, version]);
  return read;
}

type Mode = "visual" | "yaml";

/**
 * A file the assistant wrote, as a card: its Project and path, then the file shown as the game
 * would (a menu, opened on its own screen) or as YAML against what the server runs now.
 */
export function ArtifactCard({
  artifact,
  version,
  serverId,
  projects,
}: {
  artifact: Artifact;
  /** The last event that wrote into its draft. */
  version: number;
  serverId: string;
  projects: readonly Project[];
}) {
  const { t } = useTranslation();
  const read = useDraft(artifact.project, artifact.draftId, version);
  const base = projects.find((p) => isProject(p, artifact.project));
  const menuId = menuIdOfPath(artifact.path);
  const [mode, setMode] = useState<Mode>("visual");
  // A menu of a loaded Project shows as the game would; anything else as YAML.
  const visual = menuId != null && base != null;
  const shown: Mode = visual ? mode : "yaml";

  const snapshot = read.status === "ready" ? read.draft.snapshot : null;
  const before = snapshot ? (snapshot.baseline[artifact.path] ?? null) : null;
  const after = snapshot ? (snapshot.tree[artifact.path] ?? null) : null;
  const stats = useMemo(
    () => (snapshot ? diffStats(before, after) : null),
    [snapshot, before, after],
  );

  // The server's Projects, this one as the draft has it: its menus open the draft's others.
  const preview = useMemo(() => {
    if (!snapshot || !base || !menuId) return null;
    const drafted = projectFromDraftTree(base, snapshot.tree);
    if (!menusOf(drafted).some((m) => m.id === menuId)) return null;
    return projects.map((p) => (p === base ? drafted : p));
  }, [snapshot, base, menuId, projects]);

  const projectName = base?.name ?? artifact.project.slice(artifact.project.indexOf(".") + 1);
  return (
    <article
      className="card flex flex-col gap-3 p-3"
      data-testid="assistant-artifact"
      aria-label={`${projectName} · ${artifact.path}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-[var(--text-faint)]" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-[var(--text)]">
              <span className="text-[var(--text-mut)]">{projectName} · </span>
              <span className="font-mono">{artifact.path}</span>
            </p>
            {artifact.draftName && (
              <p className="truncate text-[11.5px] text-[var(--text-faint)]">
                {t("ai.page.draft", { name: artifact.draftName })}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats && (
            <span className="font-mono text-[11.5px]">
              {before === null ? (
                <span className="text-[var(--success)]">{t("ai.page.added")}</span>
              ) : after === null ? (
                <span className="text-[var(--danger)]">{t("ai.page.deleted")}</span>
              ) : stats.added + stats.removed === 0 ? (
                <span className="text-[var(--text-faint)]">{t("ai.page.same")}</span>
              ) : (
                <>
                  <span className="text-[var(--success)]">+{stats.added}</span>{" "}
                  <span className="text-[var(--danger)]">−{stats.removed}</span>
                </>
              )}
            </span>
          )}
          {visual && (
            <Segmented
              label={t("ai.page.view")}
              value={shown}
              onChange={setMode}
              options={[
                { value: "visual", label: t("ai.page.visual") },
                { value: "yaml", label: t("ai.page.yaml") },
              ]}
            />
          )}
        </div>
      </header>
      {read.status === "loading" ? (
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-mut)]">
          <Spinner className="size-3.5" />
          {t("ai.page.reading")}
        </p>
      ) : read.status === "failed" ? (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]">
          {t("ai.page.unreadable")}
        </p>
      ) : shown === "visual" && menuId && base ? (
        preview ? (
          <MenuPlayPreview
            serverId={serverId}
            projects={preview}
            projectId={base.id}
            menuId={menuId}
          />
        ) : (
          <p className="text-[12.5px] text-[var(--text-mut)]">{t("ai.page.menuUnreadable")}</p>
        )
      ) : (
        <FileDiff
          before={before}
          after={after}
          beforeLabel={t("deploy.server")}
          afterLabel={t("deploy.draft")}
          context={100_000}
          wrap
        />
      )}
    </article>
  );
}
