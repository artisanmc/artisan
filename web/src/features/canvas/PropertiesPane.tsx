import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { CommandProperties } from "./properties/CommandProperties";
import { MenuProperties } from "./properties/MenuProperties";
import { PackProperties } from "./properties/PackProperties";

interface PropertiesPaneProps {
  packId: PackId;
  /** When true, render only the body (no <aside> wrapper). Used by RightSidebar. */
  embedded?: boolean;
}

export function PropertiesPane({ packId, embedded }: PropertiesPaneProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const ids = useSelectionStore((s) => s.ids);

  if (!pack) return null;

  const selectedId = ids.size === 1 ? [...ids][0] : null;
  const menu = selectedId ? pack.menus.find((m) => m.id === selectedId) : undefined;
  const command = selectedId ? pack.commands.find((c) => c.id === selectedId) : undefined;

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
