import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssetId, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { useTitleSelectionStore } from "../titleSelectionStore";

interface LayerSidePanelProps {
  packId: PackId;
  menuId: MenuId;
}

export function LayerSidePanel({ packId, menuId }: LayerSidePanelProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);

  if (!menu) return null;
  if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= menu.title.length) {
    return (
      <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-4 text-center text-[11px] text-zinc-500">
        No layer selected. Click a layer on the canvas, or use + Image / + Text below.
      </div>
    );
  }

  const layer = menu.title[selectedIndex]!;
  if (layer.kind === "text") {
    return (
      <TextLayerPanel
        packId={packId}
        menuId={menuId}
        index={selectedIndex}
        layer={layer}
      />
    );
  }
  // Image/external branches added in Task 9.
  return null;
}

interface TextLayerPanelProps {
  packId: PackId;
  menuId: MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "text" }>;
}

function TextLayerPanel({ packId, menuId, index, layer }: TextLayerPanelProps) {
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const removeLayer = useAccountStore((s) => s.removeMenuTitleLayer);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const assets = useAssetStore((s) => s.assets);
  const fonts = useMemo(() => assets.filter((a) => a.type === "font"), [assets]);

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div>
        <label htmlFor="layer-text" className="mb-1 block text-[10px] uppercase text-zinc-500">
          Text (MiniMessage) — {textEdit.lang}
        </label>
        <textarea
          id="layer-text"
          value={textEdit.value}
          onChange={(e) =>
            setI18nValue({ packId, lt: layer.value, lang: textEdit.lang, value: e.target.value })
          }
          className="min-h-[60px] w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-zinc-500">Preview</div>
        <MiniMessageInline source={textEdit.value} className="font-mono text-xs" />
      </div>

      <div>
        <label htmlFor="layer-font" className="mb-1 block text-[10px] uppercase text-zinc-500">
          Font
        </label>
        <select
          id="layer-font"
          value={layer.fontAssetId ?? ""}
          onChange={(e) => {
            const value = e.target.value === "" ? undefined : (e.target.value as AssetId);
            updateLayer({
              packId,
              menuId,
              index,
              patch: { fontAssetId: value } as Partial<Extract<MenuTitleLayer, { kind: "text" }>>,
            });
          }}
          className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
        >
          <option value="">vanilla</option>
          {fonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <label htmlFor="layer-x" className="flex-1">
          <span className="block text-[10px] uppercase text-zinc-500">x</span>
          <Input
            id="layer-x"
            type="number"
            value={layer.x}
            onChange={(e) => {
              const x = Number(e.target.value);
              if (Number.isFinite(x)) {
                updateLayer({
                  packId,
                  menuId,
                  index,
                  patch: { x } as Partial<Extract<MenuTitleLayer, { kind: "text" }>>,
                });
              }
            }}
            className="h-8 font-mono text-xs"
          />
        </label>
        <label htmlFor="layer-y" className="flex-1">
          <span className="block text-[10px] uppercase text-zinc-500">y</span>
          <Input
            id="layer-y"
            type="number"
            value={layer.y}
            onChange={(e) => {
              const y = Number(e.target.value);
              if (Number.isFinite(y)) {
                updateLayer({
                  packId,
                  menuId,
                  index,
                  patch: { y } as Partial<Extract<MenuTitleLayer, { kind: "text" }>>,
                });
              }
            }}
            className="h-8 font-mono text-xs"
          />
        </label>
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          removeLayer({ packId, menuId, index });
          setSelected(null);
        }}
      >
        Delete layer
      </Button>
    </div>
  );
}
