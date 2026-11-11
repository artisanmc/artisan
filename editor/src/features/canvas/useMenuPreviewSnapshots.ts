import type { Menu } from "@/domain/types";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useServersStore } from "@/state/serversStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";
import { directSourceRefs } from "./menuPreviewScope";

/**
 * Loads the live-server snapshots of a menu's source inputs (cached via
 * preview) so the canvas renders REAL rows for module sources, not just the
 * static connector sample. Returns the snapshots by ref.
 */
export function useMenuPreviewSnapshots(menu: Menu) {
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const loadSnapshot = useServerSnapshotsStore((s) => s.loadSnapshot);
  const serverId = useServersStore((s) => s.activeServerId);
  // Whose eyes we preview through: a per-player source returns nothing useful
  // with `player = null`, so pass the chosen player down to the fetcher.
  const previewPlayer = useUiStore((s) => s.previewPlayer);
  useEffect(() => {
    if (!serverId) return;
    for (const input of menu.contextInputs ?? []) {
      if (input.kind === "sourceRef" && !String(input.ref).startsWith("pack:")) {
        // The input's own params (`group: daily`) still apply — the preview player
        // is added to them, it does not replace them.
        const declared = (input.params ?? {}) as Record<string, string>;
        const params = previewPlayer ? { ...declared, player: previewPlayer } : declared;
        loadSnapshot({
          serverId,
          ref: String(input.ref),
          ...(Object.keys(params).length > 0 ? { params } : {}),
        });
      }
    }
    // An element may iterate a source ref directly, without declaring an input.
    for (const ref of directSourceRefs(menu)) {
      if (ref.startsWith("pack:")) continue;
      loadSnapshot({
        serverId,
        ref,
        ...(previewPlayer ? { params: { player: previewPlayer } } : {}),
      });
    }
  }, [menu, serverId, loadSnapshot, previewPlayer]);
  return snapshots;
}
