import { useMemo } from "react";
import { useAccountStore } from "@/state/accountStore";
import { compute, type FieldLocation, type PlaceholderEntry } from "@/lib/placeholderCatalog";
import type { PackId } from "@/domain/types";

/**
 * Subscribe to the active pack and recompute the placeholder catalog when
 * either the pack ref or the field location changes. Callers pass the
 * resulting `entries` array into `<PlaceholderInput entries={...} />`.
 */
export function usePlaceholderEntries(
  packId: PackId,
  location: FieldLocation,
): PlaceholderEntry[] {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  return useMemo(() => (pack ? compute(pack, location) : []), [pack, location]);
}
