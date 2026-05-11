import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import type { Menu, MenuTitleLayer, PackId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useAssetStore } from "@/features/assets/assetStore";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";

interface TitleTextEditorProps {
  packId: PackId;
  menu: Menu;
  /** Index of the layer to edit inside `menu.title`. */
  index: number;
  onClose: () => void;
}

/**
 * Modal for editing a `text`-kind title layer:
 *  - the LText value (resolved against the active language)
 *  - the optional color override
 *  - the optional custom font asset
 *
 * Live-edit: every form interaction writes through to the account store
 * immediately. The Close button (or Dialog overlay click) simply hides the
 * modal — there is no Save button.
 */
export function TitleTextEditor({ packId, menu, index, onClose }: TitleTextEditorProps) {
  const layer = menu.title[index];
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const updateMenuTitleLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const fontAssetId =
    layer && layer.kind === "text" ? layer.fontAssetId : undefined;
  const fontAsset = useAssetStore((s) =>
    fontAssetId ? s.assets.find((a) => a.id === fontAssetId) : undefined,
  );
  const textLayer = layer && layer.kind === "text" ? layer : undefined;
  const edit = useTextEdit(packId, textLayer?.value);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Guard: rendering is parent-controlled (parent passes a valid text-layer
  // index). If the index points to nothing or to a non-text layer, render
  // nothing — defensive against stale indices after a layer reorder/delete.
  if (!textLayer) return null;

  const onTextChange = (value: string) => {
    setI18nValue({ packId, lt: textLayer.value, lang: edit.lang, value });
  };

  const onColorChange = (color: string) => {
    updateMenuTitleLayer({
      packId,
      menuId: menu.id,
      index,
      patch: { color } as Partial<MenuTitleLayer>,
    });
  };

  const onColorClear = () => {
    updateMenuTitleLayer({
      packId,
      menuId: menu.id,
      index,
      patch: { color: undefined } as Partial<MenuTitleLayer>,
    });
  };

  const onFontPick = (asset: Asset) => {
    updateMenuTitleLayer({
      packId,
      menuId: menu.id,
      index,
      patch: { fontAssetId: asset.id } as Partial<MenuTitleLayer>,
    });
    setPickerOpen(false);
  };

  const onFontClear = () => {
    updateMenuTitleLayer({
      packId,
      menuId: menu.id,
      index,
      patch: { fontAssetId: undefined } as Partial<MenuTitleLayer>,
    });
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="flex max-w-md flex-col gap-4 border-zinc-800 bg-zinc-950 p-4 text-zinc-200">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit text layer</DialogTitle>
          </DialogHeader>

          <FieldRow
            label={`Text (${edit.lang})${edit.isFallback ? " — fallback" : ""}`}
          >
            <Input
              data-testid="title-text-input"
              value={edit.value}
              onChange={(e) => onTextChange(e.target.value)}
            />
          </FieldRow>

          <FieldRow label="Color">
            <div className="flex items-center gap-2">
              <input
                data-testid="title-color-input"
                type="color"
                value={textLayer.color ?? "#ffffff"}
                onChange={(e) => onColorChange(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-zinc-800 bg-zinc-900"
              />
              <span className="font-mono text-[11px] text-zinc-500">
                {textLayer.color ?? "default (white)"}
              </span>
              <button
                type="button"
                data-testid="title-color-clear"
                onClick={onColorClear}
                disabled={textLayer.color === undefined}
                className="ml-auto rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </FieldRow>

          <FieldRow label="Font">
            <div className="flex items-center gap-2">
              <span
                data-testid="title-font-name"
                className="font-mono text-[11px] text-zinc-300"
              >
                {fontAsset ? fontAsset.name : "vanilla"}
              </span>
              <button
                type="button"
                data-testid="title-font-pick"
                onClick={() => setPickerOpen(true)}
                className="ml-auto rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                Pick font…
              </button>
              <button
                type="button"
                data-testid="title-font-clear"
                onClick={onFontClear}
                disabled={fontAssetId === undefined}
                className="rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </FieldRow>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        typeFilter="font"
        onPick={onFontPick}
        title="Pick a font"
      />
    </>
  );
}

interface FieldRowProps {
  label: string;
  children: React.ReactNode;
}

function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-mono uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}
