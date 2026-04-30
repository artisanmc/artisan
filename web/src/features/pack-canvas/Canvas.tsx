import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { Background, Controls, type Node, type NodeChange, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { autoLayout } from "./autoLayout";
import { deriveEdges } from "./deriveEdges";
import { CommandNode, type CommandNodeData } from "./nodes/CommandNode";
import { MenuNode, type MenuNodeData } from "./nodes/MenuNode";

const nodeTypes = { menu: MenuNode, command: CommandNode };

interface CanvasProps {
  packId: PackId;
}

export function Canvas({ packId }: CanvasProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);

  const layout = useMemo(() => (pack ? autoLayout(pack) : {}), [pack]);

  const nodes: Node[] = useMemo(() => {
    if (!pack) return [];
    const menuNodes: Node[] = pack.menus.map((menu) => ({
      id: menu.id,
      type: "menu",
      position: layout[menu.id] ?? { x: 0, y: 0 },
      data: { menu, packId } satisfies MenuNodeData,
    }));
    const cmdNodes: Node[] = pack.commands.map((command) => ({
      id: command.id,
      type: "command",
      position: layout[command.id] ?? { x: 0, y: 0 },
      data: { command } satisfies CommandNodeData,
    }));
    return [...menuNodes, ...cmdNodes];
  }, [pack, layout, packId]);

  const edges = useMemo(() => (pack ? deriveEdges(pack) : []), [pack]);

  const onNodesChange = (changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position && !change.dragging) {
        setCanvasPosition({
          packId,
          nodeId: change.id,
          x: change.position.x,
          y: change.position.y,
        });
      }
    }
  };

  if (!pack) return <div className="p-8">Pack not found</div>;

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
