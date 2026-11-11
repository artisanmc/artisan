import { useServerProjects } from "@/features/project/useServerProjects";
import { useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PlayView } from "./PlayView";

const ROUTE = "/servers/$serverId/play" as const;

export interface PlaySearch {
  /** The Project the launcher lists first, by its id on disk ("Test in game"). */
  project?: string;
}

export const validatePlaySearch = (search: Record<string, unknown>): PlaySearch =>
  typeof search.project === "string" && search.project ? { project: search.project } : {};

/**
 * The server's Play mode: every Project of the server loaded as its own view loads it
 * (disk + draft), then played together, as the game runs them.
 */
export function PlayPage() {
  const { t } = useTranslation();
  const { serverId } = useParams({ from: ROUTE });
  const { project: focus } = useSearch({ from: ROUTE }) as PlaySearch;
  const { projects, probes, listing, settled, done, total, failedCount } =
    useServerProjects(serverId);

  const status =
    listing === "loading"
      ? t("play.listing")
      : listing === "unavailable"
        ? t("play.unavailable")
        : !settled
          ? t("play.loading", { done, total })
          : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]" data-testid="play-page">
      {probes}
      {/* The server page's frame above carries the title and the way back: a bar only to wait. */}
      {(status || failedCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-6 py-2">
          {status && <span className="text-[12px] text-[var(--text-mut)]">{status}</span>}
          {failedCount > 0 && (
            <span className="badge badge-brick">{t("play.failed", { count: failedCount })}</span>
          )}
        </div>
      )}
      {listing === "ready" && (
        <div className="flex min-h-0 flex-1 overflow-auto px-6 py-4">
          <PlayView serverId={serverId} projects={projects} focus={focus} />
        </div>
      )}
    </div>
  );
}
