import { useState } from "react";

import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import type { AssetId, MenuTitleLayer, PackId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useAssetStore } from "@/features/assets/assetStore";
import { duplicateAsset, updateAsset } from "@/lib/packApi";
import { cn } from "@/lib/cx";
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
  if (layer.kind === "plain") {
    return (
      <PlainLayerForm
        packId={packId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
  if (layer.kind === "textarea") {
    return (
      <TextareaLayerForm
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
  const [patchingAscent, setPatchingAscent] = useState(false);

  const isGlyph = asset?.type === "glyph";
  const currentAscent = asset?.ascent ?? null;
  const currentX = layer.kind === "glyph" ? layer.x : 0;

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
      console.error("LayerEditForm: duplicate failed", err);
    } finally {
      setDuplicating(false);
    }
  };

  const TITLE_LABEL_Y = 13;

  const onPatchAscent = async (value: number) => {
    if (!token || !asset) return;
    setPatchingAscent(true);
    try {
      const updated = await updateAsset(token, asset.id, { ascent: value });
      upsertAsset(updated);
      // Keep layer.y in sync with the new ascent so the canvas reflects the
      // change immediately (layer.y = titleLabelY - ascent).
      if (layer.kind === "glyph") {
        updateLayer({
          packId,
          menuId,
          index,
          patch: { y: TITLE_LABEL_Y - value } as Partial<MenuTitleLayer>,
        });
      }
    } catch (err) {
      console.error("LayerEditForm: ascent patch failed", err);
    } finally {
      setPatchingAscent(false);
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

      {layer.kind === "glyph" && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase text-zinc-500">Position horizontale (x)</div>
          <Input
            type="number"
            value={currentX}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ packId, menuId, index, patch: { x: v } as Partial<MenuTitleLayer> });
              }
            }}
            className="h-7 w-20 font-mono text-xs"
          />
          <div className="text-[10px] text-zinc-500">
            Position depuis le bord gauche du coffre (px).
          </div>
        </div>
      )}

      {isGlyph && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase text-zinc-500">Position verticale (ascent)</div>
          <Input
            type="number"
            key={currentAscent}
            defaultValue={currentAscent ?? 8}
            disabled={patchingAscent}
            className="h-7 w-20 font-mono text-xs"
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v !== currentAscent) onPatchAscent(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (Number.isFinite(v) && v !== currentAscent) onPatchAscent(v);
              }
            }}
          />
        </div>
      )}

      <AssetPicker
        open={pickerOpen}
        // No typeFilter → shows every image asset (texture + glyph). The
        // upload UX no longer distinguishes the two, so the picker
        // shouldn't either.
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

function TextLayerForm({ packId, menuId, index, layer }: TextLayerFormProps) {
  const { t } = useTranslation();
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const allAssets = useAssetStore((s) => s.assets);
  const fontAssets = allAssets.filter((a) => a.type === "font");

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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="layer-edit-font" className="text-[10px] uppercase text-zinc-500">Police personnalisée</label>
        <select
          id="layer-edit-font"
          value={layer.fontAssetId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            updateLayer({
              packId,
              menuId,
              index,
              patch: { fontAssetId: v || undefined } as Partial<MenuTitleLayer>,
            });
          }}
          className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
        >
          <option value="">Aucune (vanilla)</option>
          {fontAssets.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        {fontAssets.length === 0 ? (
          <div className="text-[10px] text-zinc-500 leading-snug">
            Importe une police via l'onglet Assets pour afficher ce texte dans la zone d'inventaire (ascent négatif).
          </div>
        ) : null}
      </div>

      {layer.fontAssetId === undefined && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="layer-edit-size" className="text-[10px] uppercase text-zinc-500">
            {t("layerEditForm.size.label")}
          </label>
          <select
            id="layer-edit-size"
            value={layer.size ?? 8}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10) as 4 | 8 | 12 | 16 | 20 | 24 | 32;
              updateLayer({
                packId,
                menuId,
                index,
                patch: { size: n === 8 ? undefined : n } as Partial<MenuTitleLayer>,
              });
            }}
            className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
          >
            <option value={4}>{t("layerEditForm.size.options.xxs")}</option>
            <option value={8}>{t("layerEditForm.size.options.normal")}</option>
            <option value={12}>{t("layerEditForm.size.options.s")}</option>
            <option value={16}>{t("layerEditForm.size.options.m")}</option>
            <option value={20}>{t("layerEditForm.size.options.l")}</option>
            <option value={24}>{t("layerEditForm.size.options.xl")}</option>
            <option value={32}>{t("layerEditForm.size.options.xxl")}</option>
          </select>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">X</div>
          <Input
            type="number"
            value={layer.x}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ packId, menuId, index, patch: { x: v } as Partial<MenuTitleLayer> });
              }
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">Y</div>
          <Input
            type="number"
            value={layer.y}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ packId, menuId, index, patch: { y: v } as Partial<MenuTitleLayer> });
              }
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
      </div>
      <div className="text-[10px] text-zinc-500 leading-snug">
        X depuis le bord gauche (titre naturel = 8) · Y depuis le haut (barre = 5–6, inventaire ≥ 18).
      </div>
    </div>
  );
}

// ─── Plain (vanilla) ────────────────────────────────────────────────────────

interface PlainLayerFormProps {
  packId: PackId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "plain" }>;
}

function PlainLayerForm({ packId, menuId, index, layer }: PlainLayerFormProps) {
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div className="rounded border border-zinc-700 bg-zinc-900/60 px-2.5 py-2 text-[10px] text-zinc-400 leading-snug">
        Titre vanilla — aucun resource pack requis. Le texte s'affiche avec la police MC par défaut.
        MiniMessage supporté (<code className="text-zinc-300">{"<gold>"}</code>,{" "}
        <code className="text-zinc-300">{"<bold>"}</code>, etc.).
      </div>
      <div>
        <label
          htmlFor={`plain-layer-text-${index}`}
          className="mb-1 block text-[10px] uppercase text-zinc-500"
        >
          Texte (MiniMessage) — {textEdit.lang}
        </label>
        <textarea
          id={`plain-layer-text-${index}`}
          value={textEdit.value}
          onChange={(e) =>
            setI18nValue({
              packId,
              lt: layer.value,
              lang: textEdit.lang,
              value: e.target.value,
            })
          }
          className="min-h-[60px] w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
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

// ─── Textarea ──────────────────────────────────────────────────────────────

interface TextareaLayerFormProps {
  packId: PackId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "textarea" }>;
}

function TextareaLayerForm({ packId, menuId, index, layer }: TextareaLayerFormProps) {
  const { t } = useTranslation();
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const allAssets = useAssetStore((s) => s.assets);
  const fontAssets = allAssets.filter((a) => a.type === "font");

  // Y-overflow: line i renders at y + i*lineHeight, must be ≤ 140.
  const lines = textEdit.value.split("\n");
  const lastLineY = layer.y + (lines.length - 1) * layer.lineHeight;
  const overflows = lastLineY > 140;

  const setAlignment = (a: "left" | "center" | "right") =>
    updateLayer({
      packId, menuId, index,
      patch: { alignment: a } as Partial<MenuTitleLayer>,
    });

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div>
        <label
          htmlFor={`textarea-layer-content-${index}`}
          className="mb-1 block text-[10px] uppercase text-zinc-500"
        >
          Texte (MiniMessage, multi-ligne) — {textEdit.lang}
        </label>
        <textarea
          id={`textarea-layer-content-${index}`}
          data-testid="textarea-content"
          value={textEdit.value}
          onChange={(e) =>
            setI18nValue({
              packId,
              lt: layer.value,
              lang: textEdit.lang,
              value: e.target.value,
            })
          }
          rows={3}
          className="min-h-[80px] w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-zinc-500">Aperçu</div>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order is stable within preview
          <MiniMessageInline key={i} source={line} className="font-mono text-xs" />
        ))}
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">Hauteur de ligne (px)</div>
          <Input
            type="number"
            data-testid="textarea-line-height"
            value={layer.lineHeight}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              if (!Number.isFinite(raw)) return;
              const clamped = Math.min(32, Math.max(1, raw));
              updateLayer({
                packId, menuId, index,
                patch: { lineHeight: clamped } as Partial<MenuTitleLayer>,
              });
            }}
            className="h-7 w-full font-mono text-xs"
          />
          <button
            type="button"
            onClick={() =>
              updateLayer({
                packId, menuId, index,
                patch: { lineHeight: (layer.size ?? 8) + 2 } as Partial<MenuTitleLayer>,
              })
            }
            className="h-7 rounded border border-zinc-700 bg-zinc-800 px-2 text-[10px] text-zinc-300 hover:bg-zinc-700"
          >
            {t("layerEditForm.size.align")}
          </button>
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">Alignement</div>
          <div className="flex rounded border border-zinc-700 bg-zinc-900 p-0.5">
            <button
              type="button"
              data-testid="textarea-align-left"
              onClick={() => setAlignment("left")}
              className={cn(
                "flex-1 rounded p-1",
                layer.alignment === "left" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400",
              )}
              title="Aligner à gauche"
              aria-label="Aligner à gauche"
            >
              <AlignLeft className="mx-auto h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="textarea-align-center"
              onClick={() => setAlignment("center")}
              className={cn(
                "flex-1 rounded p-1",
                layer.alignment === "center" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400",
              )}
              title="Centrer"
              aria-label="Centrer"
            >
              <AlignCenter className="mx-auto h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="textarea-align-right"
              onClick={() => setAlignment("right")}
              className={cn(
                "flex-1 rounded p-1",
                layer.alignment === "right" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400",
              )}
              title="Aligner à droite"
              aria-label="Aligner à droite"
            >
              <AlignRight className="mx-auto h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase text-zinc-500">Police personnalisée</div>
        <select
          data-testid="textarea-font"
          value={layer.fontAssetId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            updateLayer({
              packId, menuId, index,
              patch: { fontAssetId: v || undefined } as Partial<MenuTitleLayer>,
            });
          }}
          className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
        >
          <option value="">Aucune (vanilla)</option>
          {fontAssets.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      {layer.fontAssetId === undefined && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="layer-edit-textarea-size" className="text-[10px] uppercase text-zinc-500">
            {t("layerEditForm.size.label")}
          </label>
          <select
            id="layer-edit-textarea-size"
            value={layer.size ?? 8}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10) as 4 | 8 | 12 | 16 | 20 | 24 | 32;
              updateLayer({
                packId, menuId, index,
                patch: { size: n === 8 ? undefined : n } as Partial<MenuTitleLayer>,
              });
            }}
            className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
          >
            <option value={4}>{t("layerEditForm.size.options.xxs")}</option>
            <option value={8}>{t("layerEditForm.size.options.normal")}</option>
            <option value={12}>{t("layerEditForm.size.options.s")}</option>
            <option value={16}>{t("layerEditForm.size.options.m")}</option>
            <option value={20}>{t("layerEditForm.size.options.l")}</option>
            <option value={24}>{t("layerEditForm.size.options.xl")}</option>
            <option value={32}>{t("layerEditForm.size.options.xxl")}</option>
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase text-zinc-500">Largeur (px)</div>
        <Input
          type="number"
          data-testid="textarea-width"
          value={layer.width}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.min(256, Math.max(8, raw));
            updateLayer({
              packId, menuId, index,
              patch: { width: clamped } as Partial<MenuTitleLayer>,
            });
          }}
          className="h-7 w-full font-mono text-xs"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">X</div>
          <Input
            type="number"
            data-testid="textarea-x"
            value={layer.x}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ packId, menuId, index, patch: { x: v } as Partial<MenuTitleLayer> });
              }
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">Y (ligne 0)</div>
          <Input
            type="number"
            data-testid="textarea-y"
            value={layer.y}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ packId, menuId, index, patch: { y: v } as Partial<MenuTitleLayer> });
              }
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
      </div>

      {overflows ? (
        <div
          data-testid="textarea-y-overflow-warning"
          className="rounded border border-amber-700 bg-amber-950/40 px-2.5 py-2 text-[11px] text-amber-200"
        >
          ⚠ Certaines lignes dépassent la zone rendable (Y &gt; 140) et seront tronquées.
        </div>
      ) : null}
    </div>
  );
}
