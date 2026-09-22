import { useMemo, useState } from "react";

import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PlaceholderInput } from "@/components/PlaceholderInput";
import { RevealField } from "@/components/RevealField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import type { AssetId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useAssetStore } from "@/features/assets/assetStore";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { duplicateAsset } from "@/lib/api/userAssets";
import { cn } from "@/lib/cx";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useUiStore } from "@/state/uiStore";

import { TextSizeSelector } from "./TextSizeSelector";
import { asTextFrame, patchTextFrame, textAnchorOffset } from "./textFrame";

interface LayerEditFormProps {
  projectId: ProjectId;
}

/**
 * The right-panel editor for the layer pointed at by `uiStore.selectedLayerKey`.
 * Dispatches on `layer.kind` and renders the appropriate sub-form. Sibling of
 * `LayerListItem`: the list selects a layer, this component edits it.
 *
 * Sub-forms intentionally share no abstraction — each layer kind has a
 * distinct shape and we want the dispatch to stay trivially readable.
 */
export function LayerEditForm({ projectId }: LayerEditFormProps) {
  const selectedKey = useUiStore((s) => s.selectedLayerKey);
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const menu = project?.menus.find((m) => m.id === selectedKey?.menuId);
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
        projectId={projectId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
  if (layer.kind === "text" || layer.kind === "textarea") {
    return (
      <TextLayerForm
        projectId={projectId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
  if (layer.kind === "plain") {
    return (
      <PlainLayerForm
        projectId={projectId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
  if (layer.kind === "external_glyph") {
    return (
      <ExternalGlyphForm
        projectId={projectId}
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
 * generic_54.png asymmetry (Mojang bug): chest slot border is at y=17 but the item
 * area starts at y=18 (1 px gap). Player-inv slot border AND item area are both at
 * y=139 (no gap). A single glyph cannot perfectly align both sections at once.
 *
 * Workaround: add 1 px of transparent padding at the very top of the background PNG,
 * then place it at y=17: transparent pixel 0→y=17 (border), content pixel 1→y=18
 * (chest item area) ✓, pixel 122→y=139 (player-inv) ✓.
 */
const Y_FOR_CHEST_BACKGROUND = 17;
/** MC draws a glyph at `13 - ascent`, and ascent may not exceed height. */
const GLYPH_Y_BASE = 13;

interface ImageLayerFormProps {
  projectId: ProjectId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer:
    | Extract<MenuTitleLayer, { kind: "background" }>
    | Extract<MenuTitleLayer, { kind: "glyph" }>;
}

function ImageLayerForm({ projectId, menuId, index, layer }: ImageLayerFormProps) {
  const asset = useAssetStore((s) => s.assets.find((a) => a.id === layer.assetId));
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const user = useAuthStore((s) => s.currentUser);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const { t } = useTranslation();

  const onPick = (picked: Asset) => {
    updateLayer({
      projectId,
      menuId,
      index,
      patch: { assetId: picked.id as AssetId } as Partial<MenuTitleLayer>,
    });
    setPickerOpen(false);
  };

  const onDuplicate = async () => {
    if (!user) return;
    if (
      !window.confirm(
        "Dupliquer cette image pour ce menu uniquement ? Les autres menus garderont l'originale.",
      )
    ) {
      return;
    }
    setDuplicating(true);
    try {
      const dup = await duplicateAsset(projectId, layer.assetId);
      upsertAsset(dup);
      updateLayer({
        projectId,
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

  const setPosition = (patch: { x?: number; y?: number }) =>
    updateLayer({ projectId, menuId, index, patch: patch as Partial<MenuTitleLayer> });

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
            {asset ? `${asset.type} · ${asset.width} × ${asset.height} px` : "image non chargée"}
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
          <div className="flex gap-3">
            {(["x", "y"] as const).map((axis) => (
              <div key={axis} className="flex flex-col gap-1">
                <span className="field-label">{t(`layerEditForm.image.${axis}`)}</span>
                <Input
                  type="number"
                  aria-label={t(`layerEditForm.image.${axis}`)}
                  value={layer[axis]}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) setPosition({ [axis]: v });
                  }}
                  className="h-7 w-20 font-mono text-xs"
                />
              </div>
            ))}
          </div>
          <div className="text-[10px] text-[var(--text-faint)] leading-snug">
            {t("layerEditForm.image.positionHint", {
              floor: asset ? GLYPH_Y_BASE - asset.height : "…",
            })}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px]"
            onClick={() => setPosition({ x: 0, y: Y_FOR_CHEST_BACKGROUND })}
          >
            {t("layerEditForm.image.calibrate", { y: Y_FOR_CHEST_BACKGROUND })}
          </Button>
          <div className="text-[10px] text-[var(--text-faint)] leading-snug">
            {t("layerEditForm.image.calibrateHint")}
          </div>
        </div>
      )}

      <AssetPicker
        usage="menu"
        open={pickerOpen}
        projectId={projectId}
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

interface PlainLayerFormProps {
  projectId: ProjectId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "plain" }>;
}

function PlainLayerForm({ projectId, menuId, layer }: PlainLayerFormProps) {
  const { t } = useTranslation();
  const textEdit = useTextEdit(projectId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const placeholderLocation = useMemo(() => ({ kind: "menu" as const, menuId }), [menuId]);
  const placeholderEntries = usePlaceholderEntries(projectId, placeholderLocation);

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div className="rounded border border-zinc-700 bg-zinc-900/60 px-2.5 py-2 text-[10px] text-zinc-400 leading-snug">
        Titre vanilla — aucun resource project requis. Le texte s'affiche avec la police MC par
        défaut. MiniMessage supporté (<code className="text-zinc-300">{"<gold>"}</code>,{" "}
        <code className="text-zinc-300">{"<bold>"}</code>, etc.).
      </div>
      <div>
        <div className="mb-1 block text-[10px] uppercase text-zinc-500">
          Titre (MiniMessage) — {textEdit.lang}
        </div>
        <RevealField
          value={textEdit.value}
          onChange={(v) =>
            setI18nValue({
              projectId,
              lt: layer.value,
              lang: textEdit.lang,
              value: v,
            })
          }
          entries={placeholderEntries}
          placeholder={t("layerEditForm.plainPlaceholder")}
          className="text-xs"
          facade={<MiniMessageInline source={textEdit.value} className="font-mono text-xs" />}
          preview={
            <div className="mt-1 rounded border border-zinc-800 bg-zinc-900/40 p-2">
              <div className="mb-1 text-[10px] uppercase text-zinc-500">Aperçu</div>
              <MiniMessageInline source={textEdit.value} className="font-mono text-xs" />
            </div>
          }
        />
      </div>
    </div>
  );
}

// ─── External glyph ────────────────────────────────────────────────────────

interface ExternalGlyphFormProps {
  projectId: ProjectId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "external_glyph" }>;
}

function ExternalGlyphForm({ projectId, menuId, index, layer }: ExternalGlyphFormProps) {
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
              projectId,
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
              projectId,
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

interface TextLayerFormProps {
  projectId: ProjectId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "text" | "textarea" }>;
}

function TextLayerForm({ projectId, menuId, index, layer: originalLayer }: TextLayerFormProps) {
  const layer = asTextFrame(originalLayer);
  const { t } = useTranslation();
  const textEdit = useTextEdit(projectId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const allAssets = useAssetStore((s) => s.assets);
  const fontAssets = allAssets.filter((a) => a.type === "font");
  const placeholderLocation = useMemo(() => ({ kind: "menu" as const, menuId }), [menuId]);
  const placeholderEntries = usePlaceholderEntries(projectId, placeholderLocation);

  // Y-overflow: line i renders at y + i*lineHeight, must be ≤ 140.
  const lines = textEdit.value.split("\n");
  const lastLineY = layer.y + (lines.length - 1) * layer.lineHeight;
  const overflows = lastLineY > 140;

  const setAlignment = (a: "left" | "center" | "right") =>
    updateLayer({
      projectId,
      menuId,
      index,
      patch: patchTextFrame(layer, { alignment: a }),
    });

  return (
    <div className="flex flex-col gap-3 text-xs text-[var(--text)]">
      <div>
        <label
          htmlFor={`textarea-layer-content-${index}`}
          className="mb-1 block text-[10px] uppercase text-[var(--text-faint)]"
        >
          Texte (MiniMessage, multi-ligne) — {textEdit.lang}
        </label>
        <PlaceholderInput
          multiline
          rows={3}
          value={textEdit.value}
          onChange={(v) => {
            if (originalLayer.kind === "text")
              updateLayer({ projectId, menuId, index, patch: layer });
            setI18nValue({
              projectId,
              lt: layer.value,
              lang: textEdit.lang,
              value: v,
            });
          }}
          entries={placeholderEntries}
          placeholder={t("layerEditForm.textareaPlaceholder")}
        />
      </div>

      <div className="rounded border border-[var(--border-soft)] bg-[var(--surface)] p-2">
        <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">Aperçu</div>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order is stable within preview
          <MiniMessageInline key={i} source={line} className="font-mono text-xs" />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <label htmlFor="text-line-height" className="field-label">
              Interligne (px)
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title={t("layerEditForm.size.alignHint")}
              onClick={() =>
                updateLayer({
                  projectId,
                  menuId,
                  index,
                  patch: {
                    ...layer,
                    lineHeight: Math.min(32, (layer.size ?? 8) + 2),
                  } as Partial<MenuTitleLayer>,
                })
              }
              className="h-auto px-1.5 py-0.5 text-[11px]"
            >
              {t("layerEditForm.size.align")}
            </Button>
          </div>
          <Input
            type="number"
            id="text-line-height"
            data-testid="textarea-line-height"
            value={layer.lineHeight}
            onChange={(e) => {
              const raw = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(raw)) return;
              const clamped = Math.min(32, Math.max(1, raw));
              updateLayer({
                projectId,
                menuId,
                index,
                patch: { ...layer, lineHeight: clamped } as Partial<MenuTitleLayer>,
              });
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-[var(--text-faint)]">Alignement</div>
          <div className="flex rounded border border-[var(--border-soft)] bg-[var(--surface)] p-0.5">
            <button
              type="button"
              data-testid="textarea-align-left"
              onClick={() => setAlignment("left")}
              className={cn(
                "btn btn-ghost flex-1 p-1",
                layer.alignment === "left"
                  ? "bg-[var(--surface-raised)] text-[var(--text)]"
                  : "text-[var(--text-mut)]",
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
                "btn btn-ghost flex-1 p-1",
                layer.alignment === "center"
                  ? "bg-[var(--surface-raised)] text-[var(--text)]"
                  : "text-[var(--text-mut)]",
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
                "btn btn-ghost flex-1 p-1",
                layer.alignment === "right"
                  ? "bg-[var(--surface-raised)] text-[var(--text)]"
                  : "text-[var(--text-mut)]",
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
        <label htmlFor="layer-edit-font" className="field-label">
          Police personnalisée
        </label>
        <select
          id="layer-edit-font"
          data-testid="textarea-font"
          value={layer.fontAssetId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            updateLayer({
              projectId,
              menuId,
              index,
              patch: { ...layer, fontAssetId: v || undefined } as Partial<MenuTitleLayer>,
            });
          }}
          className="h-8 w-full rounded border border-[var(--border-soft)] bg-[var(--surface)] px-2 text-xs text-[var(--text)]"
        >
          <option value="">Aucune (vanilla)</option>
          {fontAssets.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {fontAssets.length === 0 && (
          <div className="text-[10px] text-[var(--text-faint)]">
            Importe une police via la Bibliothèque pour utiliser une police personnalisée.
          </div>
        )}
      </div>

      {layer.fontAssetId === undefined && (
        <TextSizeSelector
          id="layer-edit-textarea-size"
          value={layer.size}
          onChange={(size) =>
            updateLayer({
              projectId,
              menuId,
              index,
              patch: { ...layer, size } as Partial<MenuTitleLayer>,
            })
          }
        />
      )}

      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase text-[var(--text-faint)]">Largeur (px)</div>
        <Input
          type="number"
          data-testid="textarea-width"
          value={layer.width}
          onChange={(e) => {
            const raw = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.min(256, Math.max(8, raw));
            updateLayer({
              projectId,
              menuId,
              index,
              patch: patchTextFrame(layer, { width: clamped }),
            });
          }}
          className="h-7 w-full font-mono text-xs"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-[var(--text-faint)]">X</div>
          <Input
            type="number"
            data-testid="textarea-x"
            value={layer.x - textAnchorOffset(layer)}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ projectId, menuId, index, patch: patchTextFrame(layer, { x: v }) });
              }
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-[var(--text-faint)]">Y (ligne 0)</div>
          <Input
            type="number"
            data-testid="textarea-y"
            value={layer.y}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({
                  projectId,
                  menuId,
                  index,
                  patch: { ...layer, y: v } as Partial<MenuTitleLayer>,
                });
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
