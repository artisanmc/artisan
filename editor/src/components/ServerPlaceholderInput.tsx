import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { papiScopeKey, useServerPapiPlaceholdersStore } from "@/state/serverPapiPlaceholdersStore";
import { useServersStore } from "@/state/serversStore";
import { PlaceholderInput, type PlaceholderInputProps } from "./PlaceholderInput";

const EMPTY: NonNullable<PlaceholderInputProps["papiPlaceholders"]> = [];

export function ServerPlaceholderInput(props: Omit<PlaceholderInputProps, "papiPlaceholders">) {
  const userId = useAuthStore((s) => s.currentUser?.id);
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const key = useServerPapiPlaceholdersStore((s) => s.key);
  const placeholders = useServerPapiPlaceholdersStore((s) => s.placeholders);
  const scope = userId && networkId && serverId ? { userId, networkId, serverId } : null;
  const matches = scope && key === papiScopeKey(scope);
  return (
    <PlaceholderInput
      {...props}
      papiPlaceholders={matches ? placeholders : EMPTY}
      onFocus={() => {
        if (scope && matches) void useServerPapiPlaceholdersStore.getState().load(scope);
        props.onFocus?.();
      }}
    />
  );
}
