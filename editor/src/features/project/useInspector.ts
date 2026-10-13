import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useMemo } from "react";
import { type SelectionContext, selectionContext } from "./selectionContext";

export interface Inspector {
  /** Should the panel exist? */
  open: boolean;
  ctx: SelectionContext;
}

/**
 * The edit panel's opening rule, written ONCE. The panel is mounted in two
 * places (the board and the focus view); duplicating it there guarantees
 * they will diverge.
 *
 * Rule: present iff something is selected — or the user explicitly asked for
 * the project settings, which match no selection.
 */
export function useInspector(projectId: ProjectId): Inspector {
  const ids = useSelectionStore((s) => s.ids);
  const selectionMenuId = useSelectionStore((s) => s.menuId);
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const projectSettingsOpen = useUiStore((s) => s.projectSettingsOpen);
  const setProjectSettingsOpen = useUiStore((s) => s.setProjectSettingsOpen);

  const ctx = useMemo(
    () => selectionContext(project, ids, selectionMenuId),
    [project, ids, selectionMenuId],
  );

  // Selecting anything puts the project settings away: otherwise going back to
  // an empty selection would reopen them right after the user deselected to
  // clear the canvas.
  useEffect(() => {
    if (ids.size > 0 && projectSettingsOpen) setProjectSettingsOpen(false);
  }, [ids.size, projectSettingsOpen, setProjectSettingsOpen]);

  return { open: ids.size > 0 || projectSettingsOpen, ctx };
}
