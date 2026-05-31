import { useMemo, useState } from "react";

import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PlaceholderInput } from "@/components/PlaceholderInput";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
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

import { TextSizeSelector } from "./TextSizeSelector";

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
      <div className="rounded border border-dashed border-[var(--line-soft)] bg-[var(--card-surface)]/40 px-3 py-4 text-center text-[11px] text-[var(--ink-faint)]">
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

/**
 * MC font rendering formula (empirically confirmed): glyph_top = 13 - ascent.
 *
 * generic_54.png asymmetry (Mojang bug): chest slot border is at y=17 but the item
 * area starts at y=18 (1 px gap). Player-inv slot border AND item area are both at
 * y=139 (no gap). A single glyph cannot perfectly align both sections at once.
 *
 * Workaround: add 1 px of transparent padding at the very top of the background PNG.
 * With ascent=-4 (glyph at y=17): transparent pixel 0→y=17 (border), actual image
 * content pixel 1→y=18 (chest item area) ✓, pixel 122→y=139 (player-inv) ✓.
 */
const ASCENT_FOR_CHEST_BACKGROUND = -4;
const Y_FOR_CHEST_BACKGROUND = 17; // glyph top = chest slot border row

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
      const dup = await duplicateAsset(token, packId, layer.assetId);
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
      const updated = await updateAsset(token, packId, asset.id, { ascent: value });
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
    <div className="flex flex-col gap-3 text-xs text-[var(--ink-2)]">
      <div className="flex items-center gap-2">
        {asset ? (
          <img
            src={assetPreviewUrl(asset)}
            alt={asset.name}
            className="h-10 w-10 rounded border border-[var(--line)] bg-[var(--card-surface)] object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="h-10 w-10 rounded border border-[var(--line)] bg-[var(--card-surface)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-[var(--ink)]">{asset?.name ?? "<image manquante>"}</div>
          <div className="text-[10px] text-[var(--ink-faint)]">
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
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">Position horizontale (x)</div>
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
          <div className="text-[10px] text-[var(--ink-faint)]">
            Position depuis le bord gauche du coffre (px).
          </div>
        </div>
      )}

      {isGlyph && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">Position verticale (ascent)</div>
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
          <Button
            size="sm"
            variant="outline"
            disabled={patchingAscent}
            className="text-[11px]"
            onClick={() => {
              onPatchAscent(ASCENT_FOR_CHEST_BACKGROUND);
              if (layer.kind === "glyph") {
                updateLayer({
                  packId,
                  menuId,
                  index,
                  patch: { x: 0, y: Y_FOR_CHEST_BACKGROUND } as Partial<MenuTitleLayer>,
                });
              }
            }}
          >
            {patchingAscent ? "…" : `Calibrer pour coffre (x=0, y=${Y_FOR_CHEST_BACKGROUND}, ascent ${ASCENT_FOR_CHEST_BACKGROUND})`}
          </Button>
          <div className="text-[10px] text-[var(--ink-faint)] leading-snug">
            {`Zone des slots : ascent ${ASCENT_FOR_CHEST_BACKGROUND} → glyphe à y=${Y_FOR_CHEST_BACKGROUND} (bordure du coffre). Pour aligner coffre ET inventaire joueur simultanément, ajoute 1px de padding transparent en haut du PNG.`}
          </div>
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
  const placeholderLocation = useMemo(
    () => ({ kind: "menu" as const, menuId }),
    [menuId],
  );
  const placeholderEntries = usePlaceholderEntries(packId, placeholderLocation);

  return (
    <div className="flex flex-col gap-3 text-xs text-[var(--ink-2)]">
      <div>
        <label
          htmlFor="layer-edit-text"
          className="mb-1 block text-[10px] uppercase text-[var(--ink-faint)]"
        >
          Texte (MiniMessage) — {textEdit.lang}
        </label>
        <PlaceholderInput
          multiline
          value={textEdit.value}
          onChange={(v) =>
            setI18nValue({
              packId,
              lt: layer.value,
              lang: textEdit.lang,
              value: v,
            })
          }
          entries={placeholderEntries}
          placeholder={t("layerEditForm.textPlaceholder")}
        />
      </div>

      <div className="rounded border border-[var(--line-soft)] bg-[var(--card-surface)]/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-[var(--ink-faint)]">Aperçu</div>
        <MiniMessageInline source={textEdit.value} className="font-mono text-xs" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="layer-edit-font" className="text-[10px] uppercase text-[var(--ink-faint)]">Police personnalisée</label>
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
          className="h-8 w-full rounded border border-[var(--line)] bg-[var(--card-surface)] px-2 text-xs text-[var(--ink)]"
        >
          <option value="">Aucune (vanilla)</option>
          {fontAssets.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        {fontAssets.length === 0 ? (
          <div className="text-[10px] text-[var(--ink-faint)] leading-snug">
            Importe une police via l'onglet Assets pour afficher ce texte dans la zone d'inventaire (ascent négatif).
          </div>
        ) : null}
      </div>

      {layer.fontAssetId === undefined && (
        <TextSizeSelector
          id="layer-edit-size"
          value={layer.size}
          onChange={(size) =>
            updateLayer({
              packId,
              menuId,
              index,
              patch: { size } as Partial<MenuTitleLayer>,
            })
          }
        />
      )}

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">X</div>
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
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">Y</div>
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
      <div className="text-[10px] text-[var(--ink-faint)] leading-snug">
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
  const { t } = useTranslation();
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const placeholderLocation = useMemo(
    () => ({ kind: "menu" as const, menuId }),
    [menuId],
  );
  const placeholderEntries = usePlaceholderEntries(packId, placeholderLocation);

  return (
    <div className="flex flex-col gap-3 text-xs text-[var(--ink-2)]">
      <div className="rounded border border-[var(--line)] bg-[var(--card-surface)]/60 px-2.5 py-2 text-[10px] text-[var(--ink-mut)] leading-snug">
        Titre vanilla — aucun resource pack requis. Le texte s'affiche avec la police MC par défaut.
        MiniMessage supporté (<code className="text-[var(--ink-2)]">{"<gold>"}</code>,{" "}
        <code className="text-[var(--ink-2)]">{"<bold>"}</code>, etc.).
      </div>
      <div>
        <label
          htmlFor={`plain-layer-text-${index}`}
          className="mb-1 block text-[10px] uppercase text-[var(--ink-faint)]"
        >
          Texte (MiniMessage) — {textEdit.lang}
        </label>
        <PlaceholderInput
          multiline
          value={textEdit.value}
          onChange={(v) =>
            setI18nValue({
              packId,
              lt: layer.value,
              lang: textEdit.lang,
              value: v,
            })
          }
          entries={placeholderEntries}
          placeholder={t("layerEditForm.plainPlaceholder")}
        />
      </div>
      <div className="rounded border border-[var(--line-soft)] bg-[var(--card-surface)]/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-[var(--ink-faint)]">Aperçu</div>
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
    <div className="flex flex-col gap-3 text-xs text-[var(--ink-2)]">
      <div>
        <label
          htmlFor="layer-edit-external-provider"
          className="mb-1 block text-[10px] uppercase text-[var(--ink-faint)]"
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
          className="h-8 w-full rounded border border-[var(--line)] bg-[var(--card-surface)] px-2 text-xs text-[var(--ink)]"
        >
          <option value="nexo">nexo</option>
          <option value="oraxen">oraxen</option>
          <option value="itemsadder">itemsadder</option>
        </select>
      </div>

      <div>
        <label
          htmlFor="layer-edit-external-name"
          className="mb-1 block text-[10px] uppercase text-[var(--ink-faint)]"
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
  const placeholderLocation = useMemo(
    () => ({ kind: "menu" as const, menuId }),
    [menuId],
  );
  const placeholderEntries = usePlaceholderEntries(packId, placeholderLocation);

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
    <div className="flex flex-col gap-3 text-xs text-[var(--ink-2)]">
      <div>
        <label
          htmlFor={`textarea-layer-content-${index}`}
          className="mb-1 block text-[10px] uppercase text-[var(--ink-faint)]"
        >
          Texte (MiniMessage, multi-ligne) — {textEdit.lang}
        </label>
        <PlaceholderInput
          multiline
          rows={3}
          value={textEdit.value}
          onChange={(v) =>
            setI18nValue({
              packId,
              lt: layer.value,
              lang: textEdit.lang,
              value: v,
            })
          }
          entries={placeholderEntries}
          placeholder={t("layerEditForm.textareaPlaceholder")}
        />
      </div>

      <div className="rounded border border-[var(--line-soft)] bg-[var(--card-surface)]/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-[var(--ink-faint)]">Aperçu</div>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order is stable within preview
          <MiniMessageInline key={i} source={line} className="font-mono text-xs" />
        ))}
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">Hauteur de ligne (px)</div>
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
            className="h-7 rounded border border-[var(--line)] bg-[var(--raised-2)] px-2 text-[10px] text-[var(--ink-2)] hover:bg-[var(--raised-2)]"
          >
            {t("layerEditForm.size.align")}
          </button>
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">Alignement</div>
          <div className="flex rounded border border-[var(--line)] bg-[var(--card-surface)] p-0.5">
            <button
              type="button"
              data-testid="textarea-align-left"
              onClick={() => setAlignment("left")}
              className={cn(
                "flex-1 rounded p-1",
                layer.alignment === "left" ? "bg-[var(--raised-2)] text-[var(--ink)]" : "text-[var(--ink-mut)]",
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
                layer.alignment === "center" ? "bg-[var(--raised-2)] text-[var(--ink)]" : "text-[var(--ink-mut)]",
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
                layer.alignment === "right" ? "bg-[var(--raised-2)] text-[var(--ink)]" : "text-[var(--ink-mut)]",
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
        <div className="text-[10px] uppercase text-[var(--ink-faint)]">Police personnalisée</div>
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
          className="h-8 w-full rounded border border-[var(--line)] bg-[var(--card-surface)] px-2 text-xs text-[var(--ink)]"
        >
          <option value="">Aucune (vanilla)</option>
          {fontAssets.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      {layer.fontAssetId === undefined && (
        <TextSizeSelector
          id="layer-edit-textarea-size"
          value={layer.size}
          onChange={(size) =>
            updateLayer({
              packId,
              menuId,
              index,
              patch: { size } as Partial<MenuTitleLayer>,
            })
          }
        />
      )}

      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase text-[var(--ink-faint)]">Largeur (px)</div>
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
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">X</div>
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
          <div className="text-[10px] uppercase text-[var(--ink-faint)]">Y (ligne 0)</div>
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
          className="rounded-[10px] border border-[var(--gold-soft)] bg-[var(--gold-soft)] px-2.5 py-2 text-[11px] text-[var(--gold)]"
        >
          ⚠ Certaines lignes dépassent la zone rendable (Y &gt; 140) et seront tronquées.
        </div>
      ) : null}
    </div>
  );
}
