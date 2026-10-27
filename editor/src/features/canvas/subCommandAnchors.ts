import { walkDocumentRefs } from "@/domain/actionArgs";
import { walkCommandNodes } from "@/domain/commandNodes";
import { type DocKey, commandsOf, docKey, parseDocKey } from "@/domain/documents";
import type { Command, EdgeAnchor, Project } from "@/domain/types";
import type { Edge } from "./deriveEdges";
import { localDocRef } from "./deriveEdges";
import { type Box, autoSide } from "./edgeRouting";
import { COMMAND_ROWS } from "./menuLayout";

/**
 * The Documents the root's own steps reference, and each sub-command row's, by row: as keys
 * (`docKey`) holding the raw ref, a qualified one included.
 */
export function commandRowRefs(command: Command): { root: DocKey[]; rows: DocKey[][] } {
  const refs = (steps: Command["steps"]) =>
    [...walkDocumentRefs(steps)].filter((r) => r.id).map((r) => docKey(r.document, r.id));
  const [root, ...rows] = [...walkCommandNodes(command)].map((v) => refs(v.node.steps));
  return { root: root ?? [], rows };
}

/**
 * The sub-command rows (their index under the root, as `commandRowRefs` lists them) whose
 * steps open [target], an edge's target key: what a hovered link points back to.
 */
export function rowsOpening(project: Project, command: Command, target: DocKey): number[] {
  const opens = (refs: DocKey[]) =>
    refs.some((r) => {
      const { kind, id } = parseDocKey(r)!;
      return docKey(kind, localDocRef(project, id)) === target;
    });
  return commandRowRefs(command).rows.flatMap((refs, i) => (opens(refs) ? [i] : []));
}

/**
 * The source anchors of the links a command's sub-commands draw: a menu only a
 * sub-command opens links from that sub-command's row, on the side facing it. A link the
 * root's own steps draw keeps the node's anchor.
 */
export function subCommandAnchors(
  project: Project,
  edges: Edge[],
  boxes: Record<string, Box>,
): Record<string, { from: EdgeAnchor }> {
  const out: Record<string, { from: EdgeAnchor }> = {};
  const commands = new Map<string, Command>(
    commandsOf(project).map((c) => [docKey("command", c.id), c]),
  );
  for (const edge of edges) {
    const command = commands.get(edge.source);
    const src = boxes[edge.source];
    const tgt = boxes[edge.target];
    if (!command || !src || !tgt) continue;
    const { root } = commandRowRefs(command);
    const local = (key: DocKey) => {
      const { kind, id } = parseDocKey(key)!;
      return docKey(kind, localDocRef(project, id));
    };
    if (root.some((r) => local(r) === edge.target)) continue;
    const row = rowsOpening(project, command, edge.target)[0];
    if (row === undefined) continue;
    const side = autoSide(src, tgt);
    const horizontal =
      side === "left" || side === "right"
        ? side
        : tgt.x + tgt.width / 2 >= src.x + src.width / 2
          ? "right"
          : "left";
    const y = COMMAND_ROWS.header + row * COMMAND_ROWS.row + (COMMAND_ROWS.row - 3) / 2;
    out[edge.id] = { from: { side: horizontal, t: y / src.height } };
  }
  return out;
}
