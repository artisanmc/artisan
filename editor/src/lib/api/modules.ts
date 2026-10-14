const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface ActiveModule {
  id: string;
  version: string | null;
}

/**
 * Active modules for the current network/server (presence activation).
 * Source: server_modules, populated at each plugin `hello`. Cookie auth,
 * `serverId` is the exact server_key id (not a slug). Returns [] on any
 * non-OK response (treat "no presence info" as "no modules").
 */
export async function fetchActiveModulesUser(
  serverId: string,
): Promise<ActiveModule[]> {
  const res = await fetch(
    `${API_URL}/api/v1/servers/${serverId}/modules`,
    { credentials: "include" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { modules?: ActiveModule[] };
  return data.modules ?? [];
}
