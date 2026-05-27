import { useEffect, useState } from "react";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { loadPacks } from "@/lib/packApi";
import { loadUserPack } from "@/lib/api/userPacks";
import type { Pack, PackId } from "@/domain/types";

/**
 * A fresh pack created via POST /api/v1/networks/:id/packs has editorJson=null
 * server-side, so loadUserPack returns editor=null. The editor expects a
 * valid Pack shape — fall back to this empty default so the canvas renders
 * an empty workspace instead of crashing into a black screen.
 */
function emptyPack(id: string, name: string): Pack {
  const now = new Date().toISOString();
  return {
    id: id as PackId,
    name,
    source: "user_created",
    createdAt: now,
    updatedAt: now,
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  };
}

export type PackLoadMode = "session" | "user";

export interface PackLoadResult {
  pack: Pack | null;
  networkId: string | null;
  error: string | null;
  mode: PackLoadMode | null;
}

export function usePackLoader(packId: string): PackLoadResult {
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);
  const [pack, setPack] = useState<Pack | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PackLoadMode | null>(null);

  useEffect(() => {
    setError(null);
    if (token) {
      setMode("session");
      loadPacks(token)
        .then((packs) => {
          const found = packs.find((p) => p.id === packId);
          if (found) setPack(found);
          else setError("Workspace not bound to this session");
        })
        .catch((e) => setError((e as Error).message));
    } else if (user) {
      setMode("user");
      loadUserPack(packId)
        .then((res) => {
          // loadUserPack returns { pack, files, editor, networkId }; editor is the full Pack JSON.
          // Fresh packs have editor=null server-side — fall back to an empty Pack shape.
          const loaded = (res.editor as Pack | null) ?? emptyPack(res.pack.id, res.pack.name);
          setPack(loaded);
          setNetworkId(res.networkId);
        })
        .catch((e) => setError((e as Error).message));
    } else {
      setError("Not authenticated");
    }
  }, [packId, token, user]);

  return { pack, networkId, error, mode };
}
