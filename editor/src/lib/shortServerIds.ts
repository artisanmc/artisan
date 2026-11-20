import { redirect } from "@tanstack/react-router";

/**
 * Short server ids in the address bar: `/servers/22206191/…` instead of
 * `/servers/22206191-e62a-4f32-9a48-a6509c95077b/…`.
 *
 * Only the URL changes. Inside the editor (route params, stores, API calls) a
 * server is still named by its full id: the router's rewrite turns the short
 * segment back into the full id before matching (`toInternalPath`) and shortens
 * it again on the way out (`toPublicPath`). A full id in the URL (an old
 * bookmark, a link already shared) keeps working and is shortened in place.
 *
 * A short id is the shortest prefix of the full id that is at least
 * `SHORT_LENGTH` characters long and that no other server of the hub shares.
 * Resolving needs the hub's server list: until it is known, the segment is left
 * as it is (`servers.$serverId` waits for the list before rendering).
 */

/** Eight hex digits, as a UUID's first group: one chance in 4 billion for two servers to share it. */
export const SHORT_LENGTH = 8;

const SERVER_SEGMENT = /^\/servers\/([^/]+)(?=\/|$)/;

let known: readonly string[] = [];
const listeners = new Set<() => void>();

/** The server ids the hub listed. `listServers` calls it with each answer. */
export function rememberServerIds(ids: readonly string[]): void {
  const next = [...new Set([...known, ...ids])].sort();
  if (next.length === known.length && next.every((id, i) => id === known[i])) return;
  known = next;
  for (const listener of listeners) listener();
}

/** Called each time a new server id becomes known. Returns the unsubscribe. */
export function onServerIdsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function knownServerIds(): readonly string[] {
  return known;
}

/** For tests. */
export function forgetServerIds(): void {
  known = [];
}

/** The id as the URL shows it. An id the hub never listed stays whole. */
export function shortServerId(id: string, ids: readonly string[] = known): string {
  if (!ids.includes(id)) return id;
  for (let length = SHORT_LENGTH; length < id.length; length++) {
    const prefix = id.slice(0, length);
    // A prefix that ends on a dash reads as truncated; the next character settles it anyway.
    if (prefix.endsWith("-")) continue;
    if (ids.every((other) => other === id || !other.startsWith(prefix))) return prefix;
  }
  return id;
}

/**
 * The full id a URL segment names: the id itself, or the one known id it is a
 * prefix of (at least `SHORT_LENGTH` long). Unknown or ambiguous → unchanged.
 */
export function resolveServerId(segment: string, ids: readonly string[] = known): string {
  if (ids.includes(segment) || segment.length < SHORT_LENGTH) return segment;
  const matches = ids.filter((id) => id.startsWith(segment));
  return matches.length === 1 && matches[0] ? matches[0] : segment;
}

/** Shorter than a UUID, made of its characters: what `shortServerId` writes. */
const SHORT_SHAPE = /^[0-9a-f][0-9a-f-]{7,34}$/i;

/** A segment that looks like a short id the server list has not resolved (yet). */
export function isUnresolvedServerId(segment: string, ids: readonly string[] = known): boolean {
  return (
    SHORT_SHAPE.test(segment) && !ids.includes(segment) && resolveServerId(segment, ids) === segment
  );
}

function mapServerSegment(pathname: string, map: (segment: string) => string): string {
  const match = SERVER_SEGMENT.exec(pathname);
  if (!match?.[1]) return pathname;
  let segment: string;
  try {
    segment = decodeURIComponent(match[1]);
  } catch {
    return pathname;
  }
  const mapped = map(segment);
  if (mapped === segment) return pathname;
  return `/servers/${encodeURIComponent(mapped)}${pathname.slice(match[0].length)}`;
}

/** Address bar → router: the short id back to the full id. */
export function toInternalPath(pathname: string, ids: readonly string[] = known): string {
  return mapServerSegment(pathname, (segment) => resolveServerId(segment, ids));
}

/** Router → address bar: the full id shortened. */
export function toPublicPath(pathname: string, ids: readonly string[] = known): string {
  return mapServerSegment(pathname, (segment) => shortServerId(segment, ids));
}

/** The router's `rewrite` option. */
export const shortServerIdRewrite = {
  input: ({ url }: { url: URL }) => {
    url.pathname = toInternalPath(url.pathname);
    return url;
  },
  output: ({ url }: { url: URL }) => {
    url.pathname = toPublicPath(url.pathname);
    return url;
  },
};

/**
 * The `beforeLoad` of `/servers/$serverId`. A short id opened before the editor knew
 * the server list (a fresh tab, a shared link): read the list, then go to the same
 * place under the full id, so no route below ever sees the short one. The address
 * bar keeps the short id. Signed out, offline or no such server: nothing happens
 * and the page handles it as before.
 */
export async function redirectToFullServerId(
  serverId: string,
  location: { pathname: string; searchStr: string; hash: string },
  loadServers: () => Promise<unknown>,
): Promise<void> {
  if (!isUnresolvedServerId(serverId)) return;
  try {
    await loadServers();
  } catch {
    return;
  }
  const internal = toInternalPath(location.pathname);
  if (internal === location.pathname) return;
  const hash = location.hash ? `#${location.hash}` : "";
  throw redirect({ href: internal + location.searchStr + hash, replace: true });
}
