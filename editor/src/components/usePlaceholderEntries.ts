import { useMemo } from "react";
import { useAccountStore } from "@/state/accountStore";
import { compute, type FieldLocation, type PlaceholderEntry } from "@/lib/placeholderCatalog";
import type { ProjectId } from "@/domain/types";

/**
 * Subscribe to the active pack and recompute the placeholder catalog when
 * either the pack ref or the field location changes. Callers pass the
 * resulting `entries` array into `<PlaceholderInput entries={...} />`.
 */
export function usePlaceholderEntries(
  projectId: ProjectId,
  location: FieldLocation,
): PlaceholderEntry[] {
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  return useMemo(() => (pack ? compute(pack, location) : []), [pack, location]);
}
