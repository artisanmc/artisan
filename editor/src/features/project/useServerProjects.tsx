import type { Project } from "@/domain/types";
import { useTextureInit } from "@/features/canvas/useTextureInit";
import { diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { listServerProjects } from "@/lib/api/projectFiles";
import { type ProjectSummary, listServers } from "@/lib/api/servers";
import { projectUrlId } from "@/lib/projectUrlId";
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
 * Every project of a server, each loaded as its own view loads it (server board, Play mode), and
 * the item icons their menus draw: vanilla's and the server's custom items, read through its
 * first Project once all are loaded (the library is the server's, whichever Project asks).
 */
export function useServerProjects(serverId: string): ServerProjects {
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null);
  const [listing, setListing] = useState<ServerProjects["listing"]>("loading");
  const [results, setResults] = useState<Record<string, ProbeResult>>({});

  useEffect(() => {
    let cancelled = false;
    setListing("loading");
    listServers()
      .then(async (servers) => {
        const key = servers.find((k) => k.id === serverId);
        if (!key) throw new Error("unknown_server");
        const res = await listServerProjects(key.id);
        if (cancelled) return;
        if (!res.ok) {
          setListing("unavailable");
          return;
        }
        setSummaries(diskProjectsToSummaries(key.id, res.projectIds, res.projects));
        setListing("ready");
      })
      .catch(() => {
        if (!cancelled) setListing("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  const onResult = useCallback((loadRef: string, result: ProbeResult) => {
    setResults((prev) => {
      const current = prev[loadRef];
      if (current && current.project === result.project && current.failed === result.failed)
        return prev;
      return { ...prev, [loadRef]: result };
    });
  }, []);

  const refs = useMemo(() => (summaries ?? []).map((s) => projectUrlId(s)), [summaries]);
  const done = refs.filter((ref) => results[ref]?.project || results[ref]?.failed).length;
  const failedCount = refs.filter((ref) => results[ref]?.failed && !results[ref]?.project).length;
  const projects = useMemo(
    () => refs.map((ref) => results[ref]?.project).filter((p): p is Project => p != null),
    [refs, results],
  );
  const settled = listing === "ready" && done === refs.length;
  useTextureInit(settled ? projects[0]?.id : undefined);
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
