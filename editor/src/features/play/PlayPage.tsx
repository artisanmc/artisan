import { useServerProjects } from "@/features/project/useServerProjects";
import { Link, useParams, useSearch } from "@tanstack/react-router";
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
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <Link to="/servers/$serverId" params={{ serverId }} className="btn btn-ghost btn-sm">
          ← {t("play.back")}
        </Link>
        <h1 className="text-[15px] font-semibold text-[var(--text)]">{t("play.title")}</h1>
        <span className="text-[12px] text-[var(--text-mut)]">{status ?? t("play.hint")}</span>
        {failedCount > 0 && (
          <span className="badge badge-brick">{t("play.failed", { count: failedCount })}</span>
        )}
      </header>
      {listing === "ready" && (
        <div className="flex min-h-0 flex-1 overflow-auto p-4">
          <PlayView serverId={serverId} projects={projects} focus={focus} />
        </div>
      )}
    </div>
  );
}
