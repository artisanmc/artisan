import type { Element, ElementId, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { CommandProperties } from "./properties/CommandProperties";
import { ElementProperties } from "./properties/ElementProperties";
import { MenuProperties } from "./properties/MenuProperties";
import { PackProperties } from "./properties/PackProperties";

interface PropertiesPaneProps {
  packId: PackId;
  /** When true, render only the body (no <aside> wrapper). Used by RightSidebar. */
  embedded?: boolean;
}

const findElement = (
  pack: ReturnType<typeof useAccountStore.getState>["account"]["packs"][number],
  id: ElementId,
): { menuId: MenuId; element: Element } | null => {
  for (const m of pack.menus) {
    for (const layer of m.layers) {
      for (const el of layer.elements) {
        if (el.id === id) return { menuId: m.id, element: el };
      }
    }
  }
  return null;
};

export function PropertiesPane({ packId, embedded }: PropertiesPaneProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const ids = useSelectionStore((s) => s.ids);

  if (!pack) return null;

  const selectedId = ids.size === 1 ? [...ids][0] : null;
  const menu = selectedId ? pack.menus.find((m) => m.id === selectedId) : undefined;
  const command = selectedId ? pack.commands.find((c) => c.id === selectedId) : undefined;
  const elementHit =
    selectedId && !menu && !command ? findElement(pack, selectedId as ElementId) : null;

  let title: string;
  let body: React.ReactNode;
  if (ids.size > 1) {
    title = `${ids.size} items selected`;
    body = (
      <div className="text-xs text-zinc-500">Multi-edit not supported in v1. Select one item.</div>
    );
  } else if (menu) {
    title = "Menu";
    body = <MenuProperties packId={packId} menu={menu} />;
  } else if (command) {
    title = "Command";
    body = <CommandProperties packId={packId} command={command} />;
  } else if (elementHit) {
    title = "Item";
    body = (
      <ElementProperties packId={packId} menuId={elementHit.menuId} element={elementHit.element} />
    );
  } else {
    title = "Pack";
    body = <PackProperties pack={pack} />;
  }

  if (embedded) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="text-xs uppercase text-zinc-500">{title}</div>
        {body}
      </div>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 border-l border-zinc-800 bg-zinc-950 p-3 text-sm">
      <div className="text-xs uppercase text-zinc-500">{title}</div>
      {body}
    </aside>
  );
}
