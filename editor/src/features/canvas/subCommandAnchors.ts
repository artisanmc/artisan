import { walkDocumentRefs } from "@/domain/actionArgs";
import { walkCommandNodes } from "@/domain/commandNodes";
import { type DocKey, commandsOf, docKey, documentsOf, parseDocKey } from "@/domain/documents";
import type { Command, EdgeAnchor, Project, Step } from "@/domain/types";
import { TRIGGER_KIND, type Trigger } from "@/modules/triggers/trigger";
import type { Edge } from "./deriveEdges";
import { localDocRef } from "./deriveEdges";
import { type Box, autoSide } from "./edgeRouting";
import { COMMAND_ROWS, TRIGGER_ROWS, triggerRowY } from "./menuLayout";

/** The Documents some steps reference, as keys (`docKey`) holding the raw ref. */
const stepRefs = (steps: Step[]): DocKey[] =>
  [...walkDocumentRefs(steps)].filter((r) => r.id).map((r) => docKey(r.document, r.id));

/** Whether one of [refs] (raw, maybe qualified) names [target], an edge's target key. */
function opens(project: Project, refs: DocKey[], target: DocKey): boolean {
  return refs.some((r) => {
    const { kind, id } = parseDocKey(r)!;
    return docKey(kind, localDocRef(project, id)) === target;
  });
}

/** A link's source anchor on the row at [y] of [src]: the side facing [tgt], left or right. */
function rowAnchor(src: Box, tgt: Box, y: number): { from: EdgeAnchor } {
  const side = autoSide(src, tgt);
  const horizontal =
    side === "left" || side === "right"
      ? side
      : tgt.x + tgt.width / 2 >= src.x + src.width / 2
        ? "right"
        : "left";
  return { from: { side: horizontal, t: y / src.height } };
}

/**
 * The Documents the root's own steps reference, and each sub-command row's, by row: as keys
 * (`docKey`) holding the raw ref, a qualified one included.
 */
export function commandRowRefs(command: Command): { root: DocKey[]; rows: DocKey[][] } {
  const [root, ...rows] = [...walkCommandNodes(command)].map((v) => stepRefs(v.node.steps));
  return { root: root ?? [], rows };
}

/**
 * The sub-command rows (their index under the root, as `commandRowRefs` lists them) whose
 * steps open [target], an edge's target key: what a hovered link points back to.
 */
export function rowsOpening(project: Project, command: Command, target: DocKey): number[] {
  return commandRowRefs(command).rows.flatMap((refs, i) =>
    opens(project, refs, target) ? [i] : [],
  );
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
    const y = COMMAND_ROWS.header + row * COMMAND_ROWS.row + (COMMAND_ROWS.row - 3) / 2;
    out[edge.id] = rowAnchor(src, tgt, y);
  }
  return out;
}

/** The step rows a Trigger node shows (its first top-level steps) whose steps open [target]. */
export function triggerRowsOpening(project: Project, trigger: Trigger, target: DocKey): number[] {
  return trigger.steps
    .slice(0, TRIGGER_ROWS.shown)
    .flatMap((step, i) => (opens(project, stepRefs([step]), target) ? [i] : []));
}

/**
 * The source anchors of the links a Trigger draws: a Document one of its shown steps opens
 * links from that step's row, on the side facing it. A link only a hidden step ("+N")
 * draws keeps the node's anchor.
 */
export function triggerStepAnchors(
  project: Project,
  edges: Edge[],
  boxes: Record<string, Box>,
): Record<string, { from: EdgeAnchor }> {
  const out: Record<string, { from: EdgeAnchor }> = {};
  const triggers = new Map<string, Trigger>(
    (documentsOf(project, TRIGGER_KIND.kind) as unknown as Trigger[]).map((t) => [
      docKey(TRIGGER_KIND.kind, t.id),
      t,
    ]),
  );
  for (const edge of edges) {
    const trigger = triggers.get(edge.source);
    const src = boxes[edge.source];
    const tgt = boxes[edge.target];
    if (!trigger || !src || !tgt) continue;
    const row = triggerRowsOpening(project, trigger, edge.target)[0];
    if (row === undefined) continue;
    out[edge.id] = rowAnchor(src, tgt, triggerRowY(row) + (TRIGGER_ROWS.row - 3) / 2);
  }
  return out;
}
