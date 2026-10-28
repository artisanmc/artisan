import type { ProjectId } from "@/domain/types";
import { type FieldLocation, type PlaceholderEntry, compute } from "@/lib/placeholderCatalog";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useMemo } from "react";

/**
 * Subscribe to the active project and recompute the placeholder catalog when
 * either the project ref or the field location changes. Callers pass the
 * resulting `entries` array into `<PlaceholderInput entries={...} />`.
 * Server-reported source schemas are threaded in so `rowOf`-typed context
 * inputs expose their fields ({cat.name}, {cat.id}…).
 */
export function usePlaceholderEntries(
  projectId: ProjectId,
  location: FieldLocation,
): PlaceholderEntry[] {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const serverSources = useServerDataSourcesStore((s) => s.sources);
  return useMemo(() => {
    if (!project) return [];
    const rowSchemas = Object.fromEntries(
      serverSources.map((src) => [
        src.ref,
        src.schema.map((f) => ({ name: f.name, type: f.type })),
      ]),
    );
    return compute(project, location, rowSchemas);
  }, [project, location, serverSources]);
}
