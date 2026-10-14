const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Who is connected to the server right now, relayed live from the plugin.
 *
 * Feeds the editor's player pickers. Deliberately forgiving: an offline server,
 * a timeout or a network error all yield an empty list rather than an error —
 * the pickers keep accepting a typed name, so nothing here can block an admin.
 */
export async function listOnlinePlayers(
  serverId: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/servers/${serverId}/players`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { players?: unknown };
    return Array.isArray(body.players) ? body.players.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}
