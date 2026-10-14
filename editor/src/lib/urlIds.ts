/** A server as the sidebar knows it: its id, its slug, and its network. */
export interface ServerRef {
  networkId: string;
  serverId: string;
  serverSlug?: string;
}

/**
 * URL-facing server identifier: link building prefers the slug and falls back
 * to the id when the slug is unknown (not loaded yet, or never set).
 *
 * Server slugs are unique **per network** ("survie" exists in many), so the
 * lookup is scoped to the network — an unscoped one could emit another
 * network's slug.
 */
export function urlServerId(
  servers: ServerRef[],
  networkId: string | null,
  serverId: string | null,
): string | null {
  if (!serverId) return null;
  const server = servers.find(
    (s) =>
      (networkId == null || s.networkId === networkId) &&
      (s.serverId === serverId || s.serverSlug === serverId),
  );
  return server?.serverSlug ?? serverId;
}
