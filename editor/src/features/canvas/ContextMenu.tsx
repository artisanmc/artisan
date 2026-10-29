import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuId, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type ContextMenuTarget =
  /** `world` is set when the click fell on the background (the selection stays the target). */
  | { kind: "entity"; selectedIds: string[]; world?: { x: number; y: number } }
  | { kind: "slot"; menuId: string; position: number; filled: boolean }
  /** Right-click on empty canvas. World coords for "create here" actions. */
  | { kind: "empty"; world: { x: number; y: number } };

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  target: ContextMenuTarget;
}

interface ContextMenuProps {
  projectId: ProjectId;
  state: ContextMenuState;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  /** Right-click on a slot: paste the copied items starting from this slot. */
  onPasteAt: (anchor: { menuId: MenuId; position: number }) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveTo: (toProjectId: ProjectId) => void;
  /** Canvas background: show the project settings in the panel. */
  onOpenProjectSettings: () => void;
  onGroup?: () => void;
  /** The kinds the "New" submenu offers, in order. */
  createKinds?: { kind: string; label: string }[];
  /** Absent in focus view: creating "here" requires a board position. */
  onCreateAt?: (kind: string, world: { x: number; y: number }) => void;
}

export function ContextMenu({
  projectId,
  state,
  onClose,
  onCopy,
  onPaste,
  onPasteAt,
  onDuplicate,
  onDelete,
  onMoveTo,
  onOpenProjectSettings,
  onGroup,
  createKinds = [],
  onCreateAt,
}: ContextMenuProps) {
  const { t } = useTranslation();
  // Stable selector to avoid the new-array-per-render pitfall — we filter in a memo.
  const projects = useProjectsStore((s) => s.openProjects.projects);
  const otherProjects = useMemo(
    () => projects.filter((p) => p.id !== projectId),
    [projects, projectId],
  );
  // The background point a Document would be created at: an empty-canvas click, or a
  // background click while something stays selected.
  const world =
    state.target.kind === "empty"
      ? state.target.world
      : state.target.kind === "entity"
        ? state.target.world
        : undefined;
  const newSubmenu =
    onCreateAt && world && createKinds.length > 0 ? (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{t("canvas.new")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {createKinds.map((c) => (
            <DropdownMenuItem key={c.kind} onSelect={() => onCreateAt(c.kind, world)}>
              {c.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : null;

  return (
    <DropdownMenu open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{ position: "fixed", left: state.x, top: state.y, width: 1, height: 1 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2}>
        {state.target.kind === "slot" ? (
          <DropdownMenuItem
            onSelect={() => {
              if (state.target.kind === "slot") {
                onPasteAt({
                  menuId: state.target.menuId as MenuId,
                  position: state.target.position,
                });
              }
            }}
          >
            {t("canvas.pasteHere")}
            <span className="ml-auto text-[11px] text-[var(--text-faint)]">⌘V</span>
          </DropdownMenuItem>
        ) : state.target.kind === "empty" ? (
          <>
            {newSubmenu && (
              <>
                {newSubmenu}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={onOpenProjectSettings}>
              {t("projectProperties.title")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPaste}>
              Paste
              <span className="ml-auto text-[11px] text-[var(--text-faint)]">⌘V</span>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {newSubmenu && (
              <>
                {newSubmenu}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={onCopy} disabled={state.target.selectedIds.length === 0}>
              Copy
              <span className="ml-auto text-[11px] text-[var(--text-faint)]">⌘C</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPaste}>
              Paste
              <span className="ml-auto text-[11px] text-[var(--text-faint)]">⌘V</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDuplicate}
              disabled={state.target.selectedIds.length === 0}
            >
              Duplicate
              <span className="ml-auto text-[11px] text-[var(--text-faint)]">⌘D</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {onGroup && (
              <DropdownMenuItem onSelect={onGroup}>
                {t("canvas.groups.createSelection")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onDelete} disabled={state.target.selectedIds.length === 0}>
              Delete
              <span className="ml-auto text-[11px] text-[var(--text-faint)]">⌫</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={state.target.selectedIds.length === 0 || otherProjects.length === 0}
              >
                Move to project
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherProjects.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => onMoveTo(p.id)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { ContextMenuState };
