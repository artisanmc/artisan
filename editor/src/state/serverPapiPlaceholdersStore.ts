import type { PapiPlaceholder } from "@/components/PlaceholderInput";
import { apiFetch } from "@/lib/api/client";
import { create } from "zustand";

export interface PapiServerScope {
  userId: string;
  serverId: string;
}

export const papiScopeKey = (scope: PapiServerScope) =>
  JSON.stringify([scope.userId, scope.serverId]);

interface State {
  key: string | null;
  placeholders: PapiPlaceholder[];
  load: (scope: PapiServerScope) => Promise<void>;
  clear: () => void;
}

export const useServerPapiPlaceholdersStore = create<State>((set) => {
  let generation = 0;
  let inFlight: { key: string; promise: Promise<void> } | null = null;
  return {
    key: null,
    placeholders: [],
    clear() {
      generation++;
      inFlight = null;
      set({ key: null, placeholders: [] });
    },
    load(scope) {
      const key = papiScopeKey(scope);
      if (inFlight?.key === key) return inFlight.promise;
      const request = ++generation;
      set({ key, placeholders: [] });
      const promise = (async () => {
        try {
          const body = await apiFetch<{ placeholders?: unknown }>(
            `/api/v1/servers/${encodeURIComponent(scope.serverId)}/papi-placeholders`,
            { timeoutMs: 7_000 },
          );
          if (generation !== request || !Array.isArray(body.placeholders)) return;
          set({ placeholders: body.placeholders });
        } catch {
          // Offline, old plugins and failed requests all leave manual input available.
        } finally {
          if (generation === request) inFlight = null;
        }
      })();
      inFlight = { key, promise };
      return promise;
    },
  };
});
