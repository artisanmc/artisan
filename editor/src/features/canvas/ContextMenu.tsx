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
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type ContextMenuTarget =
  | { kind: "entity"; selectedIds: string[] }
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
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveTo: (toProjectId: ProjectId) => void;
  /** Fond du canvas : montrer les paramètres du project dans le panneau. */
  onOpenProjectSettings: () => void;
  onGroup?: () => void;
  /** Absents en vue focus : créer « ici » suppose une position de planche. */
  onCreateMenuAt?: (world: { x: number; y: number }) => void;
  onCreateCommandAt?: (world: { x: number; y: number }) => void;
  onCreateDialogAt?: (world: { x: number; y: number }) => void;
}

export function ContextMenu({
  projectId,
  state,
  onClose,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onMoveTo,
  onOpenProjectSettings,
  onGroup,
  onCreateMenuAt,
  onCreateCommandAt,
  onCreateDialogAt,
}: ContextMenuProps) {
  const { t } = useTranslation();
  // Stable selector to avoid the new-array-per-render pitfall — we filter in a memo.
  const projects = useAccountStore((s) => s.account.projects);
  const otherProjects = useMemo(() => projects.filter((p) => p.id !== projectId), [projects, projectId]);

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
          <DropdownMenuItem disabled>
            <span className="text-[var(--text-faint)]">No slot actions yet — drag a slot out to clear it</span>
          </DropdownMenuItem>
        ) : state.target.kind === "empty" ? (
          <>
            {onCreateMenuAt && (
              <DropdownMenuItem
                onSelect={() => {
                  if (state.target.kind === "empty") onCreateMenuAt(state.target.world);
                }}
              >
                {t("canvas.newMenuHere")}
              </DropdownMenuItem>
            )}
            {onCreateCommandAt && (
              <DropdownMenuItem
                onSelect={() => {
                  if (state.target.kind === "empty") onCreateCommandAt(state.target.world);
                }}
              >
                {t("canvas.newCommandHere")}
              </DropdownMenuItem>
            )}
            {onCreateDialogAt && (
              <DropdownMenuItem
                onSelect={() => {
                  if (state.target.kind === "empty") onCreateDialogAt(state.target.world);
                }}
              >
                {t("canvas.newDialogHere")}
              </DropdownMenuItem>
            )}
            {(onCreateMenuAt || onCreateCommandAt || onCreateDialogAt) && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={onOpenProjectSettings}>
              {t("projectProperties.title")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPaste}>
              Paste
              <span className="ml-auto text-[10px] text-[var(--text-faint)]">⌘V</span>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={onCopy} disabled={state.target.selectedIds.length === 0}>
              Copy
              <span className="ml-auto text-[10px] text-[var(--text-faint)]">⌘C</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPaste}>
              Paste
              <span className="ml-auto text-[10px] text-[var(--text-faint)]">⌘V</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDuplicate}
              disabled={state.target.selectedIds.length === 0}
            >
              Duplicate
              <span className="ml-auto text-[10px] text-[var(--text-faint)]">⌘D</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {onGroup && <DropdownMenuItem onSelect={onGroup}>{t("canvas.groups.createSelection")}</DropdownMenuItem>}
            <DropdownMenuItem onSelect={onDelete} disabled={state.target.selectedIds.length === 0}>
              Delete
              <span className="ml-auto text-[10px] text-[var(--text-faint)]">⌫</span>
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
