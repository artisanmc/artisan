import { useMemo } from "react";
import { useAccountStore } from "@/state/accountStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { compute, type FieldLocation, type PlaceholderEntry } from "@/lib/placeholderCatalog";
import type { ProjectId } from "@/domain/types";

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
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const serverSources = useServerDataSourcesStore((s) => s.sources);
  return useMemo(() => {
    if (!project) return [];
    const rowSchemas = Object.fromEntries(
      serverSources.map((src) => [src.ref, src.schema.map((f) => ({ name: f.name, type: f.type }))]),
    );
    return compute(project, location, rowSchemas);
  }, [project, location, serverSources]);
}
