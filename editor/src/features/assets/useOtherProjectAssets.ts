import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { useEffect, useState } from "react";
import { listLocalAssets } from "./localAssets";

export interface OtherProjectAssets {
  assets: Asset[];
  loading: boolean;
  error: string | null;
}

/**
 * The assets of another project of the server, as published on its disk: the
 * same state the server index gives for its captured items, never a draft. Kept
 * out of the asset store, which holds the project being edited. `null` reads nothing.
 */
export function useOtherProjectAssets(projectId: ProjectId | null): OtherProjectAssets {
  const [state, setState] = useState<OtherProjectAssets>({
    assets: [],
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (!projectId) {
      setState({ assets: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ assets: [], loading: true, error: null });
    listLocalAssets(projectId, {})
      .then((assets) => {
        if (!cancelled) setState({ assets, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ assets: [], loading: false, error: (e as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return state;
}
