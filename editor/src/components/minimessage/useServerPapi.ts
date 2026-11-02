import type { PapiPlaceholder } from "@/components/PlaceholderInput";
import { useAuthStore } from "@/state/authStore";
import { papiScopeKey, useServerPapiPlaceholdersStore } from "@/state/serverPapiPlaceholdersStore";
import { useServersStore } from "@/state/serversStore";

const EMPTY: PapiPlaceholder[] = [];

/**
 * The active server's PlaceholderAPI placeholders, as `ServerPlaceholderInput` offers
 * them: none outside a server; `load` on focus asks the server once per scope.
 */
export function useServerPapi(): { placeholders: PapiPlaceholder[]; load: () => void } {
  const userId = useAuthStore((s) => s.currentUser?.id);
  const serverId = useServersStore((s) => s.activeServerId);
  const key = useServerPapiPlaceholdersStore((s) => s.key);
  const placeholders = useServerPapiPlaceholdersStore((s) => s.placeholders);
  const scope = userId && serverId ? { userId, serverId } : null;
  const matches = scope !== null && key === papiScopeKey(scope);
  return {
    placeholders: matches ? placeholders : EMPTY,
    load: () => {
      if (scope && !matches) void useServerPapiPlaceholdersStore.getState().load(scope);
    },
  };
}
