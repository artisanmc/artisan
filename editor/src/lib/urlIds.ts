/** A server as the sidebar knows it: its id and its slug. */
export interface ServerRef {
  serverId: string;
  serverSlug?: string;
}

/**
 * URL-facing server identifier: link building prefers the slug and falls back
 * to the id when the slug is unknown (not loaded yet, or never set).
 */
export function urlServerId(servers: ServerRef[], serverId: string | null): string | null {
  if (!serverId) return null;
  const server = servers.find((s) => s.serverId === serverId || s.serverSlug === serverId);
  return server?.serverSlug ?? serverId;
}
