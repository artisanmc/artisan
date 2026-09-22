import { useEffect, useState } from "react";
import useImage from "use-image";
import { useProjectPrincipalId } from "./projectPrincipal";

interface Preview {
  controller: AbortController;
  objectUrl?: string;
  loading?: boolean;
  retryTimer?: ReturnType<typeof setTimeout>;
  listeners: Set<() => void>;
}

const previews = new Map<string, Preview>();

/** Share private bytes while previews are mounted, including picker-to-canvas handoff. */
export function useAuthenticatedImageUrl(url: string) {
  const ownerId = useProjectPrincipalId();
  const [, refresh] = useState(0);
  const scope = JSON.stringify([ownerId, url]);
  useEffect(() => {
    if (!url || !ownerId) return;
    let preview = previews.get(scope);
    if (!preview) {
      const entry: Preview = { controller: new AbortController(), listeners: new Set() };
      preview = entry;
      previews.set(scope, entry);
    }
    const entry = preview;
    const notify = () => refresh((version) => version + 1);
    entry.listeners.add(notify);
    if (!entry.objectUrl && !entry.loading) {
      entry.loading = true;
      let retries = 0;
      const load = () => {
        entry.retryTimer = undefined;
        if (entry.controller.signal.aborted) return;
        void fetch(url, { credentials: "include", signal: entry.controller.signal })
          .then(async (response) => {
            if (!response.ok) {
              if (response.status >= 500 && retries < 2 && !entry.controller.signal.aborted) {
                entry.retryTimer = setTimeout(load, 500 * ++retries);
              }
              return;
            }
            const blob = await response.blob();
            if (entry.controller.signal.aborted) return;
            entry.objectUrl = URL.createObjectURL(blob);
            for (const notify of entry.listeners) notify();
          })
          .catch(() => {})
          .finally(() => {
            if (!entry.retryTimer) entry.loading = false;
          });
      };
      load();
    }
    // Another consumer may have finished between render and this effect.
    if (entry.objectUrl) notify();
    return () => {
      entry.listeners.delete(notify);
      queueMicrotask(() => {
        if (entry.listeners.size) return;
        entry.controller.abort();
        clearTimeout(entry.retryTimer);
        if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
        if (previews.get(scope) === entry) previews.delete(scope);
      });
    };
  }, [url, ownerId, scope]);
  return ownerId && url ? (previews.get(scope)?.objectUrl ?? "") : "";
}

/** Blob URLs keep authenticated images drawable without tainting the canvas. */
export function useAuthenticatedImage(url: string) {
  return useImage(useAuthenticatedImageUrl(url));
}
