import { sampleValue } from "@/lib/expr/sampleRender";
import { sampleData } from "@/lib/expr/sampleScope";
import { Scope } from "@/lib/expr/scope";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { useCallback, useMemo, useState } from "react";

/** The example player a text is shown for: placeholder samples, with what the user set. */
export interface Simulation {
  scope: Scope;
  /** The scope's values as plain data, for a preview resolved elsewhere (an item's). */
  data: Record<string, unknown>;
  /** What the user set in the "example player" panel, by path. */
  overrides: Record<string, unknown>;
  setOverride: (path: string, value: unknown) => void;
  /** Back to the samples. */
  reset: () => void;
  /** What a `{…}` (braces included) gives for the example player, null when unknown. */
  sampleOf: (raw: string) => string | null;
}

const NO_OVERRIDES: Record<string, unknown> = {};

/** `base`: the screen's own preview data (a menu element's), if it has some. */
export function useSimulation(
  entries: PlaceholderEntry[],
  base?: Record<string, unknown>,
): Simulation {
  const [overrides, setOverrides] = useState<Record<string, unknown>>(NO_OVERRIDES);
  const data = useMemo(() => sampleData(entries, overrides, base), [entries, overrides, base]);
  const scope = useMemo(() => new Scope(data), [data]);
  const samples = useMemo(
    () => new Map(entries.flatMap((e) => (e.sample === null ? [] : [[e.path, e.sample]]))),
    [entries],
  );
  const setOverride = useCallback(
    (path: string, value: unknown) => setOverrides((prev) => ({ ...prev, [path]: value })),
    [],
  );
  const reset = useCallback(() => setOverrides(NO_OVERRIDES), []);
  const sampleOf = useCallback(
    (raw: string) => {
      const own = sampleValue(raw, scope);
      // Else the catalog's sample: it knows what `{player.first_seen.ago()}` reads.
      return own ? own : (samples.get(raw.slice(1, -1)) ?? own);
    },
    [scope, samples],
  );
  return { scope, data, overrides, setOverride, reset, sampleOf };
}
