import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import type { AssetId, Menu, MenuTitleLayer, PackId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { newI18nKey } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { TitleLayerList } from "./TitleLayerList";
import { TitleMockup } from "./TitleMockup";
import { TitleTextEditor } from "./TitleTextEditor";

interface TitleComposerProps {
  packId: PackId;
  menu: Menu;
}

type PickerState = { kind: "background" | "glyph" } | null;

/**
 * Top-level panel for composing a menu's title bar. Stitches together:
 *  - {@link TitleMockup}      — live Konva preview of the title bar
 *  - Add-layer buttons        — background / glyph / text
 *  - {@link TitleLayerList}   — ordered layer list with select/reorder/delete
 *  - {@link AssetPicker}      — modal opened by + Background / + Glyph
 *  - {@link TitleTextEditor}  — modal opened by double-clicking a text row
 *
 * Local UI state (which picker is open, which text layer is being edited)
 * stays here so the children remain stateless and easy to test.
 */
export function TitleComposer({ packId, menu }: TitleComposerProps) {
  const addLayer = useAccountStore((s) => s.addMenuTitleLayer);
  const [picker, setPicker] = useState<PickerState>(null);
  const [textEditor, setTextEditor] = useState<number | null>(null);

  const onAddBackground = () => setPicker({ kind: "background" });
  const onAddGlyph = () => setPicker({ kind: "glyph" });
  const onAddText = () =>
    addLayer({
      packId,
      menuId: menu.id,
      layer: { kind: "text", value: { key: newI18nKey() }, x: 8, y: 5 },
    });

  const onPickAsset = (asset: Asset) => {
    if (!picker) return;
    // `asset.id` is the unbranded `domain/asset.AssetId` (= string); the
    // `MenuTitleLayer` field uses the branded `domain/types.AssetId`.
    // Same runtime value, just a TS brand — cast here.
    const assetId = asset.id as AssetId;
    const layer: MenuTitleLayer =
      picker.kind === "background"
        ? { kind: "background", assetId }
        : { kind: "glyph", assetId, x: 0, y: 0 };
    addLayer({ packId, menuId: menu.id, layer });
    setPicker(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <TitleMockup packId={packId} menu={menu} />
      <div className="flex gap-1">
        <Button size="sm" onClick={onAddBackground}>
          + Background
        </Button>
        <Button size="sm" onClick={onAddGlyph}>
          + Glyph
        </Button>
        <Button size="sm" onClick={onAddText}>
          + Text
        </Button>
      </div>
      <TitleLayerList packId={packId} menu={menu} onEditText={setTextEditor} />
      {picker && (
        <AssetPicker
          open
          typeFilter="glyph"
          onClose={() => setPicker(null)}
          onPick={onPickAsset}
        />
      )}
      {textEditor !== null && (
        <TitleTextEditor
          packId={packId}
          menu={menu}
          index={textEditor}
          onClose={() => setTextEditor(null)}
        />
      )}
    </div>
  );
}
