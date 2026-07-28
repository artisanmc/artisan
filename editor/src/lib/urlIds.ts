import type { NetworkSummary } from "@/lib/api/networks";

/** A server as the sidebar knows it: its id, its slug, and its network. */
export interface ServerRef {
  networkId: string;
  serverId: string;
  serverSlug?: string;
}

/**
 * URL-facing identifiers. Routes resolve **either** form (id or slug), but a
 * link should read `/networks/mon-reseau/servers/survie`, not a pair of opaque
 * ids — so link building prefers the slug and falls back to the id when the
 * slug is unknown (not loaded yet, or never set).
 */
export function urlNetworkId(networks: NetworkSummary[], networkId: string | null): string | null {
  if (!networkId) return null;
  const net = networks.find((n) => n.id === networkId || n.slug === networkId);
  return net?.slug ?? networkId;
}

/**
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
