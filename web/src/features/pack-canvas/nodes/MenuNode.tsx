import type { Menu, PackId } from "@/domain/types";
import { Link } from "@tanstack/react-router";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

export interface MenuNodeData extends Record<string, unknown> {
  menu: Menu;
  packId: PackId;
}

export type MenuNodeType = Node<MenuNodeData, "menu">;

export function MenuNode({ data }: NodeProps<MenuNodeType>) {
  const { menu, packId } = data;
  return (
    <div className="min-w-[140px] rounded-md border border-zinc-600 bg-zinc-800 p-2">
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      <Link
        to="/pack/$packId/menu/$menuId"
        params={{ packId, menuId: menu.id }}
        className="block"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 font-mono font-semibold text-xs text-zinc-200">{menu.title}</div>
        <div className="text-[10px] text-zinc-500">
          {menu.id} · {menu.rows}×9
        </div>
      </Link>
      <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
    </div>
  );
}
