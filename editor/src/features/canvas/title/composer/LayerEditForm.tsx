import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import type { AssetId, MenuTitleLayer, PackId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useAssetStore } from "@/features/assets/assetStore";
import { duplicateAsset } from "@/lib/packApi";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";

interface LayerEditFormProps {
  packId: PackId;
}

/**
 * The right-panel editor for the layer pointed at by `uiStore.selectedLayerKey`.
 * Dispatches on `layer.kind` and renders the appropriate sub-form. Sibling of
 * `LayerListItem`: the list selects a layer, this component edits it.
 *
 * Sub-forms intentionally share no abstraction — each layer kind has a
 * distinct shape and we want the dispatch to stay trivially readable.
 */
export function LayerEditForm({ packId }: LayerEditFormProps) {
  const selectedKey = useUiStore((s) => s.selectedLayerKey);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === selectedKey?.menuId);
  const layer =
    selectedKey && menu && selectedKey.index >= 0 && selectedKey.index < menu.title.length
      ? menu.title[selectedKey.index]
      : undefined;

  if (!selectedKey || !menu || !layer) {
    return (
      <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-4 text-center text-[11px] text-zinc-500">
        Sélectionne un élément pour modifier ses détails
      </div>
    );
  }

  if (layer.kind === "background" || layer.kind === "glyph") {
    return (
      <ImageLayerForm
        packId={packId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
  if (layer.kind === "text") {
    return (
      <TextLayerForm
        packId={packId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
  if (layer.kind === "external_glyph") {
    return (
      <ExternalGlyphForm
        packId={packId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
  return null;
}

// ─── Image (background | glyph) ────────────────────────────────────────────

interface ImageLayerFormProps {
  packId: PackId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer:
    | Extract<MenuTitleLayer, { kind: "background" }>
    | Extract<MenuTitleLayer, { kind: "glyph" }>;
}

function ImageLayerForm({ packId, menuId, index, layer }: ImageLayerFormProps) {
  const asset = useAssetStore((s) => s.assets.find((a) => a.id === layer.assetId));
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const token = useSessionStore((s) => s.accessToken);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const onPick = (picked: Asset) => {
    updateLayer({
      packId,
      menuId,
      index,
      patch: { assetId: picked.id as AssetId } as Partial<MenuTitleLayer>,
    });
    setPickerOpen(false);
  };

  const onDuplicate = async () => {
    if (!token) return;
    if (
      !window.confirm(
        "Dupliquer cette image pour ce menu uniquement ? Les autres menus garderont l'originale.",
      )
    ) {
      return;
    }
    setDuplicating(true);
    try {
      const dup = await duplicateAsset(token, layer.assetId);
      upsertAsset(dup);
      updateLayer({
        packId,
        menuId,
        index,
        patch: { assetId: dup.id as AssetId } as Partial<MenuTitleLayer>,
      });
    } catch (err) {
      // Surfacing to UI is the caller's job; log so dev sees it.
      console.error("LayerEditForm: duplicate failed", err);
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div className="flex items-center gap-2">
        {asset ? (
          <img
            src={assetPreviewUrl(asset)}
            alt={asset.name}
            className="h-10 w-10 rounded border border-zinc-700 bg-zinc-900 object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="h-10 w-10 rounded border border-zinc-700 bg-zinc-900" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-zinc-200">{asset?.name ?? "<image manquante>"}</div>
          <div className="text-[10px] text-zinc-500">
            {/* `width` is intentionally local-only — MC fonts derive glyph
                width from PNG transparency, so the backend doesn't persist a
                width field. ResizeHandles mutates `asset.width` optimistically
                in `assetStore` (via `useTitleLayerDrag.onResize`) for live
                preview; only `height` round-trips through PATCH. The number
                below therefore reflects the latest optimistic value, not a
                server-confirmed one. */}
            {asset
              ? `${asset.type} · ${asset.width} × ${asset.height} px`
              : "image non chargée"}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
          Choisir une image…
        </Button>
        <Button size="sm" variant="outline" onClick={onDuplicate} disabled={duplicating}>
          {duplicating ? "Duplication…" : "Dupliquer l'image"}
        </Button>
      </div>

      <AssetPicker
        open={pickerOpen}
        typeFilter="glyph"
        onClose={() => setPickerOpen(false)}
        onPick={onPick}
        title="Choisir une image"
      />
    </div>
  );
}

// ─── Text ──────────────────────────────────────────────────────────────────

interface TextLayerFormProps {
  packId: PackId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "text" }>;
}

function TextLayerForm({ packId, layer }: TextLayerFormProps) {
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div>
        <label
          htmlFor="layer-edit-text"
          className="mb-1 block text-[10px] uppercase text-zinc-500"
        >
          Texte (MiniMessage) — {textEdit.lang}
        </label>
        <textarea
          id="layer-edit-text"
          value={textEdit.value}
          onChange={(e) =>
            setI18nValue({
              packId,
              lt: layer.value,
              lang: textEdit.lang,
              value: e.target.value,
            })
          }
          className="min-h-[80px] w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-zinc-500">Aperçu</div>
        <MiniMessageInline source={textEdit.value} className="font-mono text-xs" />
      </div>
    </div>
  );
}

// ─── External glyph ────────────────────────────────────────────────────────

interface ExternalGlyphFormProps {
  packId: PackId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "external_glyph" }>;
}

function ExternalGlyphForm({ packId, menuId, index, layer }: ExternalGlyphFormProps) {
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div>
        <label
          htmlFor="layer-edit-external-provider"
          className="mb-1 block text-[10px] uppercase text-zinc-500"
        >
          Provider
        </label>
        <select
          id="layer-edit-external-provider"
          value={layer.provider}
          onChange={(e) => {
            const provider = e.target.value as "oraxen" | "nexo" | "itemsadder";
            updateLayer({
              packId,
              menuId,
              index,
              patch: { provider } as Partial<MenuTitleLayer>,
            });
          }}
          className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
        >
          <option value="nexo">nexo</option>
          <option value="oraxen">oraxen</option>
          <option value="itemsadder">itemsadder</option>
        </select>
      </div>

      <div>
        <label
          htmlFor="layer-edit-external-name"
          className="mb-1 block text-[10px] uppercase text-zinc-500"
        >
          Glyph name
        </label>
        <Input
          id="layer-edit-external-name"
          value={layer.glyphName}
          onChange={(e) => {
            updateLayer({
              packId,
              menuId,
              index,
              patch: { glyphName: e.target.value } as Partial<MenuTitleLayer>,
            });
          }}
          className="h-8 font-mono text-xs"
        />
      </div>
    </div>
  );
}
