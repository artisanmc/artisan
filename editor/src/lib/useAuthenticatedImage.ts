import { useEffect, useState } from "react";
import useImage from "use-image";
import { useProjectPrincipalId } from "./projectPrincipal";

/** Blob URLs keep authenticated images drawable without tainting the canvas. */
export function useAuthenticatedImage(url: string) {
  const ownerId = useProjectPrincipalId();
  const [loaded, setLoaded] = useState<{ scope: string; url: string } | null>(null);
  const scope = `${ownerId ?? ""}:${url}`;
  useEffect(() => {
    if (!url || !ownerId) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(url, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("image_unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ scope, url: objectUrl });
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, ownerId, scope]);
  return useImage(loaded?.scope === scope ? loaded.url : "");
}
