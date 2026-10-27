import { sampleValue } from "@/lib/expr/sampleRender";
import { sampleScope } from "@/lib/expr/sampleScope";
import type { Scope } from "@/lib/expr/scope";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { useCallback, useMemo, useState } from "react";

/** The example player a text is shown for: placeholder samples, with switches the user flipped. */
export interface Simulation {
  scope: Scope;
  overrides: Record<string, boolean>;
  setOverride: (path: string, value: boolean) => void;
  /** What a `{…}` (braces included) gives for the example player, null when unknown. */
  sampleOf: (raw: string) => string | null;
}

export function useSimulation(entries: PlaceholderEntry[]): Simulation {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const scope = useMemo(() => sampleScope(entries, overrides), [entries, overrides]);
  const samples = useMemo(
    () => new Map(entries.flatMap((e) => (e.sample === null ? [] : [[e.path, e.sample]]))),
    [entries],
  );
  const setOverride = useCallback(
    (path: string, value: boolean) => setOverrides((prev) => ({ ...prev, [path]: value })),
    [],
  );
  const sampleOf = useCallback(
    (raw: string) => {
      const own = sampleValue(raw, scope);
      // Else the catalog's sample: it knows what `{player.first_seen.ago()}` reads.
      return own ? own : (samples.get(raw.slice(1, -1)) ?? own);
    },
    [scope, samples],
  );
  return { scope, overrides, setOverride, sampleOf };
}
