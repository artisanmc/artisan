import type { Command } from "@/domain/types";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

export interface CommandNodeData extends Record<string, unknown> {
  command: Command;
}

export type CommandNodeType = Node<CommandNodeData, "command">;

export function CommandNode({ data }: NodeProps<CommandNodeType>) {
  const { command } = data;
  return (
    <div className="min-w-[140px] rounded-md border border-amber-600 bg-zinc-800 p-2">
      <div className="font-mono font-semibold text-amber-300 text-xs">/{command.name}</div>
      <div className="text-[10px] text-zinc-500">command</div>
      <Handle type="source" position={Position.Right} className="!bg-amber-600" />
    </div>
  );
}
