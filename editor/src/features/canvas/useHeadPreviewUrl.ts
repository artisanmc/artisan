import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { useEffect, useState } from "react";
import { headPreviewUrl } from "./headTexture";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const cache = new Map<
  string,
  { expires: number; pending: Promise<string | undefined>; url?: string }
>();

function resolve(networkId: string, serverId: string, id: string, key: string) {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.pending;
  const entry = {
    expires: Number.POSITIVE_INFINITY,
    pending: Promise.resolve<string | undefined>(undefined),
    url: undefined as string | undefined,
  };
  entry.pending = (async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/v1/networks/${encodeURIComponent(networkId)}/servers/${encodeURIComponent(serverId)}/head-texture?id=${id}`,
        { credentials: "include", signal: AbortSignal.timeout(7_000) },
      );
      if (!response.ok) return undefined;
      const body = await response.json();
      if (typeof body.texture === "string") entry.url = headPreviewUrl(`basehead:${body.texture}`);
      return entry.url;
    } catch {
      return undefined;
    } finally {
      entry.expires = Date.now() + (entry.url ? 10 * 60_000 : 30_000);
      if (cache.size > 512) {
        for (const [oldKey, old] of cache) {
          if (oldKey !== key && Number.isFinite(old.expires)) cache.delete(oldKey);
          if (cache.size <= 512) break;
        }
      }
    }
  })();
  cache.set(key, entry);
  return entry.pending;
}

/** HDB is resolved by the selected server; ordinary skins need no server lookup. */
export function useHeadPreviewUrl(head: string | undefined): string | undefined {
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const id = head?.match(/^hdb:(\d{1,10})$/)?.[1];
  const key = networkId && serverId && id ? JSON.stringify([networkId, serverId, id]) : "";
  const [resolved, setResolved] = useState<{ key: string; url?: string }>();

  useEffect(() => {
    if (!key || !networkId || !serverId || !id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const url = await resolve(networkId, serverId, id, key);
      if (cancelled) return;
      setResolved({ key, url });
      if (!url) timer = setTimeout(load, 30_000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, networkId, serverId, id]);

  return (
    headPreviewUrl(head) ??
    (key ? (resolved?.key === key ? resolved.url : cache.get(key)?.url) : undefined)
  );
}
