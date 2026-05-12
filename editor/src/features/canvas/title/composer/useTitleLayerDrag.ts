import { useCallback, useRef } from "react";

import type { Asset } from "@/domain/asset";
import type { AssetId, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { updateAsset } from "@/lib/packApi";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";

export interface UseTitleLayerDragArgs {
  menuId: MenuId;
  layerIndex: number;
}

export interface UseTitleLayerDragHandlers {
  /** Continuous: applied on every drag-move tick. Optimistic, no backend. */
  onPositionChange: (newPos: { x: number; y: number }) => void;
  /** Continuous: image layers only. Optimistic, no backend. */
  onResize: (dims: { width: number; height: number }) => void;
  /** End of drag: commits to backend. Rolls back assetStore on failure. */
  onResizeEnd: (dims: { width: number; height: number }) => Promise<void>;
}

/**
 * Find the menu (and its owning pack id) by menuId, scanning all packs in
 * the account. Returns `null` if the menu is not found. We accept the
 * O(packs * menus) cost because (a) packs/menus are small per-account, and
 * (b) keeping the hook signature `(menuId, layerIndex)` matches how Konva
 * callbacks reference layers from inside a menu group — they don't carry
 * pack context.
 */
function findMenu(menuId: MenuId): { packId: PackId; layer: MenuTitleLayer[] } | null {
  const packs = useAccountStore.getState().account.packs;
  for (const pack of packs) {
    const menu = pack.menus.find((m) => m.id === menuId);
    if (menu) return { packId: pack.id, layer: menu.title };
  }
  return null;
}

/** Returns the asset id referenced by an image layer (background/glyph), or null. */
function imageLayerAssetId(layer: MenuTitleLayer | undefined): AssetId | null {
  if (!layer) return null;
  if (layer.kind === "background" || layer.kind === "glyph") return layer.assetId;
  return null;
}

/**
 * Coordinates the two distinct mutations that happen during a title-layer
 * drag:
 *
 *   - `onPositionChange` is layer-local (it only touches `MenuTitleLayer.x/y`
 *     on the specific layer). Bypasses the backend entirely — positions are
 *     part of the pack/menu file, not the asset.
 *
 *   - `onResize` / `onResizeEnd` are asset-scoped: resizing a background or
 *     glyph layer changes the **asset's** dimensions (so every layer that
 *     references the same asset rescales coherently). `onResize` is
 *     optimistic-only; `onResizeEnd` is the single backend commit, with
 *     rollback on failure (snapshot taken at the start of the drag).
 *
 * The hook intentionally has no UI: parents (the Konva title group)
 * forward Konva drag events into these handlers and the stores re-render
 * everything else.
 */
export function useTitleLayerDrag(args: UseTitleLayerDragArgs): UseTitleLayerDragHandlers {
  const { menuId, layerIndex } = args;
  // Pre-drag asset snapshot. Captured on the first onResize call of a drag
  // (= "drag start" — Konva's resize protocol has no explicit start event
  // available here, but the first move is functionally equivalent), cleared
  // on every onResizeEnd. Used to roll back if the backend rejects.
  const preDragAssetRef = useRef<Asset | null>(null);

  const onPositionChange = useCallback(
    (newPos: { x: number; y: number }) => {
      const found = findMenu(menuId);
      if (!found) return;
      const layer = found.layer[layerIndex];
      if (!layer) return;
      // background has no x/y — drag should never wire it up, but guard to
      // keep the hook robust to caller mistakes.
      if (layer.kind === "background") return;
      useAccountStore.getState().updateMenuTitleLayer({
        packId: found.packId,
        menuId,
        index: layerIndex,
        patch: { x: newPos.x, y: newPos.y } as Partial<MenuTitleLayer>,
      });
    },
    [menuId, layerIndex],
  );

  const onResize = useCallback(
    (dims: { width: number; height: number }) => {
      const found = findMenu(menuId);
      if (!found) return;
      const layer = found.layer[layerIndex];
      const assetId = imageLayerAssetId(layer);
      if (!assetId) return; // text / external_glyph / invalid index — no-op
      const asset = useAssetStore.getState().assets.find((a) => a.id === assetId);
      if (!asset) return;
      // Capture the pre-drag snapshot on the FIRST onResize of a drag so we
      // can roll back if onResizeEnd's API call fails. Subsequent onResize
      // ticks reuse the same snapshot — we want the rollback target to be
      // the user's last committed state, not the previous tick's optimistic
      // value.
      if (!preDragAssetRef.current) preDragAssetRef.current = asset;
      // Note: `width` is mutated locally only. MC fonts derive glyph width
      // from PNG transparency, so the backend has no width field — only
      // `height` is sent in `onResizeEnd`. Keeping width in the optimistic
      // assetStore lets the canvas re-render with the new bounds during
      // drag; on reload, width is re-derived from the PNG.
      useAssetStore.getState().upsertAsset({
        ...asset,
        width: dims.width,
        height: dims.height,
      });
    },
    [menuId, layerIndex],
  );

  const onResizeEnd = useCallback(
    async (dims: { width: number; height: number }) => {
      const found = findMenu(menuId);
      if (!found) {
        preDragAssetRef.current = null;
        return;
      }
      const layer = found.layer[layerIndex];
      const assetId = imageLayerAssetId(layer);
      if (!assetId) {
        preDragAssetRef.current = null;
        return;
      }
      const token = useSessionStore.getState().accessToken;
      if (!token) {
        preDragAssetRef.current = null;
        return;
      }
      // Snapshot to restore on failure. Falls back to the current store
      // state if onResize was never called (e.g. direct programmatic
      // resizeEnd) — in that case rollback is a no-op since nothing
      // changed yet.
      const snapshot =
        preDragAssetRef.current ??
        useAssetStore.getState().assets.find((a) => a.id === assetId) ??
        null;
      try {
        const updated = await updateAsset(token, assetId, { height: dims.height });
        useAssetStore.getState().upsertAsset(updated);
      } catch (err) {
        if (snapshot) useAssetStore.getState().upsertAsset(snapshot);
        // No toast at this layer — the parent component is responsible for
        // surfacing the error (per P1.4 spec). We log so the failure is at
        // least visible in dev.
        console.error("useTitleLayerDrag: PATCH asset failed", err);
      } finally {
        preDragAssetRef.current = null;
      }
    },
    [menuId, layerIndex],
  );

  return { onPositionChange, onResize, onResizeEnd };
}
