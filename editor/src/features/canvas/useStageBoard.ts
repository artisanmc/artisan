import type { Project } from "@/domain/types";
import { useMemo, useState } from "react";
import type { GroupDrag } from "./BoardGroupFrames";
import { projectBoard } from "./autoLayout";

/**
 * The whole board / focus difference lives here. The board shows every
 * Document, arranged (`projectBoard`), `canvasLayout` keeping only the
 * positions set by hand; focus builds a synthetic board of a single Document
 * placed at the origin. Everything that follows — edges, off-board chips,
 * marquee, hit-test, drop — consumes `layout` and follows unknowingly.
 *
 * A group header being dragged (`groupDrag`) shifts its members live.
 */
export function useStageBoard(project: Project | undefined, focus: string | undefined) {
  const [groupDrag, setGroupDrag] = useState<GroupDrag | null>(null);
  const baseBoard = useMemo(() => {
    if (focus || !project) return null;
    const arrangement = projectBoard(project);
    return { ...arrangement, groups: arrangement.groups.filter((group) => group.kind === "group") };
  }, [project, focus]);
  const board = useMemo(() => {
    if (!baseBoard || !groupDrag) return baseBoard;
    const group = baseBoard.groups.find((g) => g.key === groupDrag.key);
    if (!group) return baseBoard;
    const members = new Set(group.members);
    const shift = (p: { x: number; y: number }) => ({
      x: p.x + groupDrag.dx,
      y: p.y + groupDrag.dy,
    });
    return {
      ...baseBoard,
      layout: Object.fromEntries(
        Object.entries(baseBoard.layout).map(([id, p]) => [id, members.has(id) ? shift(p) : p]),
      ),
      groups: baseBoard.groups.map((g) =>
        group.kind === "project" || g.key === group.key ? { ...g, ...shift(g) } : g,
      ),
    };
  }, [baseBoard, groupDrag]);
  const layout = useMemo(
    () => (focus ? { [focus]: { x: 0, y: 0 } } : (board?.layout ?? {})),
    [board, focus],
  );
  return { board, layout, setGroupDrag };
}
