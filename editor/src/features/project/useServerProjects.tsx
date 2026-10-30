import type { Project } from "@/domain/types";
import { useTextureInit } from "@/features/canvas/useTextureInit";
import { diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { listServerProjects } from "@/lib/api/projectFiles";
import { type ProjectSummary, listServers } from "@/lib/api/servers";
import { projectUrlId } from "@/lib/projectUrlId";
import { useAuthStore } from "@/state/authStore";
import { useUiStore } from "@/state/uiStore";
import { type ReactNode, createElement, useCallback, useEffect, useMemo, useState } from "react";
import { useProjectLoader } from "./useProjectLoader";

interface ProbeResult {
  project: Project | null;
  failed: boolean;
}

/** Loads a project exactly like its own view (disk + draft), so a server view shows the same thing. */
function ProjectProbe({
  loadRef,
  serverId,
  onResult,
}: {
  loadRef: string;
  serverId: string;
  onResult: (loadRef: string, result: ProbeResult) => void;
}) {
  const { project, error, offline } = useProjectLoader(loadRef, serverId);
  const failed = error != null || offline;
  useEffect(() => onResult(loadRef, { project, failed }), [loadRef, project, failed, onResult]);
  return null;
}

/**
 * What a server's views last saw, kept for the session: coming back to the Play tab
 * shows it at once, and the listing and the loaders revalidate it behind.
 */
interface Seen {
  summaries: ProjectSummary[];
  results: Record<string, ProbeResult>;
}
/** By user and server: another account never sees what this one saw. */
const seenByServer = new Map<string, Seen>();

export interface ServerProjects {
  /** The loaded projects, in the server's order. */
  projects: Project[];
  /** The loaders: render them once, anywhere in the page. */
  probes: ReactNode;
  listing: "loading" | "ready" | "unavailable";
  /** Every project loaded or failed. */
  settled: boolean;
  done: number;
  total: number;
  failedCount: number;
}

/**
 * Every project of a server, each loaded as its own view loads it (Play mode), and
 * the item icons their menus draw: vanilla's and the server's custom items, read through its
 * first Project once all are loaded (the library is the server's, whichever Project asks).
 */
export function useServerProjects(serverId: string): ServerProjects {
  const userId = useAuthStore((s) => s.currentUser?.id ?? "");
  const memoryKey = `${userId}|${serverId}`;
  const seen = seenByServer.get(memoryKey);
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(seen?.summaries ?? null);
  const [listing, setListing] = useState<ServerProjects["listing"]>(seen ? "ready" : "loading");
  const [results, setResults] = useState<Record<string, ProbeResult>>(seen?.results ?? {});

  useEffect(() => {
    let cancelled = false;
    // Already seen: what is on screen stays while the listing is read again.
    const known = seenByServer.get(memoryKey);
    setSummaries(known?.summaries ?? null);
    setResults(known?.results ?? {});
    setListing(known ? "ready" : "loading");
    listServers()
      .then(async (servers) => {
        const key = servers.find((k) => k.id === serverId);
        if (!key) throw new Error("unknown_server");
        const res = await listServerProjects(key.id);
        if (cancelled) return;
        if (!res.ok) {
          if (!seenByServer.has(memoryKey)) setListing("unavailable");
          return;
        }
        const next = diskProjectsToSummaries(key.id, res.projectIds, res.projects);
        seenByServer.set(memoryKey, {
          summaries: next,
          results: seenByServer.get(memoryKey)?.results ?? {},
        });
        setSummaries((prev) =>
          prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
        );
        setListing("ready");
      })
      .catch(() => {
        if (!cancelled && !seenByServer.has(memoryKey)) setListing("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, memoryKey]);

  const onResult = useCallback(
    (loadRef: string, result: ProbeResult) => {
      // A loader starting again reports no project before its known version: keep the
      // one already shown rather than flashing the view empty.
      if (!result.project && !result.failed) return;
      setResults((prev) => {
        const current = prev[loadRef];
        if (current && current.project === result.project && current.failed === result.failed)
          return prev;
        const next = { ...prev, [loadRef]: result };
        const known = seenByServer.get(memoryKey);
        if (known) seenByServer.set(memoryKey, { ...known, results: next });
        return next;
      });
    },
    [memoryKey],
  );

  const refs = useMemo(() => (summaries ?? []).map((s) => projectUrlId(s)), [summaries]);
  const done = refs.filter((ref) => results[ref]?.project || results[ref]?.failed).length;
  const failedCount = refs.filter((ref) => results[ref]?.failed && !results[ref]?.project).length;
  const projects = useMemo(
    () => refs.map((ref) => results[ref]?.project).filter((p): p is Project => p != null),
    [refs, results],
  );
  const settled = listing === "ready" && done === refs.length;
  // The item library is the server's: the Project the editor last opened, when it is one
  // of these, keeps the icons already drawn instead of fetching and drawing them again.
  const lastActive = useUiStore((s) => s.lastActiveProjectId);
  const libraryProject = projects.find((p) => p.id === lastActive) ?? projects[0];
  useTextureInit(settled ? libraryProject?.id : undefined);
  const probes = refs.map((ref) =>
    createElement(ProjectProbe, { key: ref, loadRef: ref, serverId, onResult }),
  );

  return {
    projects,
    probes,
    listing,
    settled,
    done,
    total: refs.length,
    failedCount,
  };
}
