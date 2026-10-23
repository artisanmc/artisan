import { commandsOf } from "@/domain/documents";
import type { EdgeAnchor, Project } from "@/domain/types";
import { moduleCommandRefs } from "@/lib/moduleCommands";
import type { Edge } from "./deriveEdges";
import { localDocRef } from "./deriveEdges";
import { type Box, autoSide } from "./edgeRouting";
import { MODULE_COMMAND_ROWS } from "./menuLayout";

/**
 * The source anchors of the links a module command's sub-commands draw: a menu only a
 * sub-command opens links from that sub-command's row, on the side facing it. A link the
 * root's own chain draws keeps the node's anchor.
 */
export function subCommandAnchors(
  project: Project,
  edges: Edge[],
  boxes: Record<string, Box>,
): Record<string, { from: EdgeAnchor }> {
  const out: Record<string, { from: EdgeAnchor }> = {};
  const commands = new Map(commandsOf(project).map((c) => [c.id as string, c]));
  for (const edge of edges) {
    const command = commands.get(edge.source);
    const src = boxes[edge.source];
    const tgt = boxes[edge.target];
    if (!command || !src || !tgt) continue;
    const { root, rows } = moduleCommandRefs(command);
    const opens = (refs: string[]) => refs.some((r) => localDocRef(project, r) === edge.target);
    if (rows.length === 0 || opens(root)) continue;
    const row = rows.findIndex(opens);
    if (row < 0) continue;
    const side = autoSide(src, tgt);
    const horizontal =
      side === "left" || side === "right"
        ? side
        : tgt.x + tgt.width / 2 >= src.x + src.width / 2
          ? "right"
          : "left";
    const y =
      MODULE_COMMAND_ROWS.header +
      row * MODULE_COMMAND_ROWS.row +
      (MODULE_COMMAND_ROWS.row - 3) / 2;
    out[edge.id] = { from: { side: horizontal, t: y / src.height } };
  }
  return out;
}
