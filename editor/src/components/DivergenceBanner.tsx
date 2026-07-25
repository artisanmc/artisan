import { Button } from "@/components/ui/button";
import { loadUserProject, resolveDivergence } from "@/lib/api/userProjects";
import { EditorWs } from "@/lib/editorWs";
import { cn } from "@/lib/cx";
import { useDivergenceStore } from "@/state/divergenceStore";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/**
 * Files-first P3c (ADR files-first-source-of-truth #6): shown when the plugin
 * reported that the server's files AND this project both moved since the last
 * sync. Nothing is overwritten in either direction until the admin picks, per
 * file, which side to keep. Resolution merges server-side, commits, re-syncs
 * the plugin and reloads this tab.
 */
export function DivergenceBanner({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const divergence = useDivergenceStore((s) => s.byProject[projectId]);
  const [choices, setChoices] = useState<Record<string, "disk" | "web">>({});
  const [resolving, setResolving] = useState(false);

  // Live nudges: the hub broadcasts sync_divergence / divergence_resolved to
  // editor connections — refetch the per-file detail (it travels on the GET)
  // so the banner appears/disappears without a manual reload. Best-effort:
  // a failed WS connect just means the banner waits for the next load.
  useEffect(() => {
    let ws: EditorWs | null = null;
    let disposed = false;
    EditorWs.connectAsUser(API_URL, {
      onSyncDivergence: (pid) => {
        if (pid !== projectId) return;
        loadUserProject(projectId)
          .then((res) => useDivergenceStore.getState().set(projectId, res.divergence))
          .catch(() => {});
      },
      onDivergenceResolved: (pid) => {
        if (pid === projectId) useDivergenceStore.getState().clear(projectId);
      },
    })
      .then((conn) => {
        if (disposed) conn.disconnect();
        else ws = conn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      ws?.disconnect();
    };
  }, [projectId]);

  const files = useMemo(() => divergence?.files ?? [], [divergence]);
  if (!divergence || files.length === 0) return null;

  const choiceOf = (path: string): "disk" | "web" => choices[path] ?? "disk";
  const setAll = (side: "disk" | "web") =>
    setChoices(Object.fromEntries(files.map((f) => [f.path, side])));

  const handleResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await resolveDivergence(
        projectId,
        Object.fromEntries(files.map((f) => [f.path, choiceOf(f.path)])),
      );
      useDivergenceStore.getState().clear(projectId);
      toast.success(t("project.divergence.resolved"));
      window.location.reload();
    } catch {
      toast.error(t("project.divergence.failed"));
      setResolving(false);
    }
  };

  return (
    <div
      role="alert"
      className="shrink-0 border-b border-[var(--border-soft)] bg-[var(--surface-raised)] px-5 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium text-[var(--text)]">
          {t("project.divergence.title")}
        </span>
        <span className="text-[13px] text-[var(--text-muted)]">
          {t("project.divergence.fileCount", { count: files.length })}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setAll("disk")}>
            {t("project.divergence.allDisk")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll("web")}>
            {t("project.divergence.allWeb")}
          </Button>
          <Button size="sm" onClick={handleResolve} disabled={resolving}>
            {resolving ? t("project.divergence.resolving") : t("project.divergence.resolve")}
          </Button>
        </span>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">{t("project.divergence.body")}</p>
      <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
        {files.map((f) => (
          <li key={f.path} className="flex flex-wrap items-center gap-2">
            <code className="text-[12px] text-[var(--text)]">{f.path}</code>
            {f.web === null && (
              <span className="text-[11px] text-[var(--text-faint)]">
                {t("project.divergence.diskOnly")}
              </span>
            )}
            {f.disk === null && (
              <span className="text-[11px] text-[var(--text-faint)]">
                {t("project.divergence.webOnly")}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={cn("chip text-[11px]", choiceOf(f.path) === "disk" && "is-active")}
                aria-pressed={choiceOf(f.path) === "disk"}
                onClick={() => setChoices((c) => ({ ...c, [f.path]: "disk" }))}
              >
                {t("project.divergence.keepDisk")}
              </button>
              <button
                type="button"
                className={cn("chip text-[11px]", choiceOf(f.path) === "web" && "is-active")}
                aria-pressed={choiceOf(f.path) === "web"}
                onClick={() => setChoices((c) => ({ ...c, [f.path]: "web" }))}
              >
                {t("project.divergence.keepWeb")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
