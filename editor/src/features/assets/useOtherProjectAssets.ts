import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { useEffect, useState } from "react";
import { listLocalAssets } from "./localAssets";

export interface OtherProjectAssets {
  assets: Asset[];
  loading: boolean;
  /** Set when no project could be read; the ones that could are still listed. */
  error: string | null;
}

/**
 * The assets of other projects of the server, as published on their disk: the
 * same state the server index gives for their captured items, never a draft.
 * Kept out of the asset store, which holds the project being edited. Read in
 * parallel, listed in the order given; an empty list reads nothing.
 */
export function useOtherProjectAssets(projectIds: readonly ProjectId[]): OtherProjectAssets {
  const [state, setState] = useState<OtherProjectAssets>({
    assets: [],
    loading: false,
    error: null,
  });
  const key = projectIds.join("\n");
  useEffect(() => {
    const ids = key ? key.split("\n") : [];
    if (ids.length === 0) {
      setState({ assets: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ assets: [], loading: true, error: null });
    void Promise.allSettled(ids.map((id) => listLocalAssets(id, {}))).then((reads) => {
      if (cancelled) return;
      const assets = reads.flatMap((read) => (read.status === "fulfilled" ? read.value : []));
      const failed = reads.find(
        (read): read is PromiseRejectedResult => read.status === "rejected",
      );
      const none = reads.every((read) => read.status === "rejected");
      setState({
        assets,
        loading: false,
        error: none && failed ? String((failed.reason as Error)?.message ?? failed.reason) : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}
