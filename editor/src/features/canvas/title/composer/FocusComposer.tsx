import { Button } from "@/components/ui/button";
import type { PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { AddLayerBar } from "./AddLayerBar";
import { ComposerCanvas } from "./ComposerCanvas";
import { LayerSidePanel } from "./LayerSidePanel";

interface FocusComposerProps {
  packId: PackId;
  menuId: MenuId;
}

export function FocusComposer({ packId, menuId }: FocusComposerProps) {
  const closeFocus = useUiStore((s) => s.closeTitleComposer);
  const removeLayer = useAccountStore((s) => s.removeMenuTitleLayer);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFocus();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selectedIndex !== null) {
        // Don't steal keystrokes from text inputs
        const ae = document.activeElement;
        if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return;
        if (menu && selectedIndex >= 0 && selectedIndex < menu.title.length) {
          removeLayer({ packId, menuId, index: selectedIndex });
          setSelected(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeFocus, removeLayer, packId, menuId, selectedIndex, menu, setSelected]);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={closeFocus}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back
        </Button>
        <span className="text-xs text-zinc-500">Editing title — {menuId}</span>
      </div>

      <div className="flex flex-1 gap-3">
        <div className="flex-1 rounded border border-zinc-800 bg-zinc-950 p-3">
          <ComposerCanvas packId={packId} menuId={menuId} />
        </div>
        <div className="w-72 rounded border border-zinc-800 bg-zinc-950 p-3">
          <LayerSidePanel packId={packId} menuId={menuId} />
        </div>
      </div>

      <AddLayerBar packId={packId} menuId={menuId} />
    </div>
  );
}
