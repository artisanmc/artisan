import { useEffect, useState } from "react";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { loadPacks } from "@/lib/packApi";
import { loadUserPack } from "@/lib/api/userPacks";
import type { Pack } from "@/domain/types";

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
          // loadUserPack returns { pack, files, editor, networkId }; editor is the full Pack JSON
          setPack(res.editor as Pack);
          setNetworkId(res.networkId);
        })
        .catch((e) => setError((e as Error).message));
    } else {
      setError("Not authenticated");
    }
  }, [packId, token, user]);

  return { pack, networkId, error, mode };
}
