import { Button } from "@/components/ui/button";
import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { InventoryGrid } from "./InventoryGrid";
import { Palette } from "./Palette";
import { Properties } from "./Properties";
import { useUndoShortcut } from "./useUndoShortcut";

interface MenuEditorProps {
  packId: PackId;
  menuId: MenuId;
}

export function MenuEditor({ packId, menuId }: MenuEditorProps) {
  const menu = useAccountStore((s) =>
    s.account.packs.find((p) => p.id === packId)?.menus.find((m) => m.id === menuId),
  );
  const load = useMenuDraftStore((s) => s.load);
  const commit = useMenuDraftStore((s) => s.commit);
  const setMaterial = useMenuDraftStore((s) => s.setMaterialAtPosition);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (menu) load({ menu, packId });
  }, [menu, packId, load]);

  useUndoShortcut();

  const onDragEnd = (e: DragEndEvent) => {
    const overData = e.over?.data.current as { kind?: "slot"; position?: number } | undefined;
    const activeData = e.active.data.current as
      | { kind?: "material"; material?: string }
      | undefined;
    if (overData?.kind !== "slot" || activeData?.kind !== "material" || overData.position == null) {
      return;
    }
    setMaterial({ position: overData.position, material: activeData.material! });
  };

  if (!menu) return <div className="p-8 text-zinc-500">Menu not found.</div>;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-screen flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm">
          <Link to="/" className="text-zinc-400 hover:text-zinc-100">
            Packs
          </Link>
          <span className="text-zinc-500">/</span>
          <Link
            to="/pack/$packId"
            params={{ packId }}
            className="text-zinc-400 hover:text-zinc-100"
          >
            {packId}
          </Link>
          <span className="text-zinc-500">/</span>
          <span className="font-mono">{menuId}</span>
          <Button onClick={() => commit()} className="ml-auto">
            Commit
          </Button>
        </header>
        <div className="flex flex-1">
          <Palette />
          <InventoryGrid />
          <Properties />
        </div>
      </div>
    </DndContext>
  );
}
