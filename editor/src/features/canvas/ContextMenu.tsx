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
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useMemo } from "react";

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
  packId: PackId;
  state: ContextMenuState;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveTo: (toPackId: PackId) => void;
  onCreateMenuAt: (world: { x: number; y: number }) => void;
  onCreateCommandAt: (world: { x: number; y: number }) => void;
}

export function ContextMenu({
  packId,
  state,
  onClose,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onMoveTo,
  onCreateMenuAt,
  onCreateCommandAt,
}: ContextMenuProps) {
  // Stable selector to avoid the new-array-per-render pitfall — we filter in a memo.
  const packs = useAccountStore((s) => s.account.packs);
  const otherPacks = useMemo(() => packs.filter((p) => p.id !== packId), [packs, packId]);

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
            <span className="text-zinc-500">No slot actions yet — drag a slot out to clear it</span>
          </DropdownMenuItem>
        ) : state.target.kind === "empty" ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                if (state.target.kind === "empty") onCreateMenuAt(state.target.world);
              }}
            >
              New menu here
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (state.target.kind === "empty") onCreateCommandAt(state.target.world);
              }}
            >
              New command here
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onPaste}>
              Paste
              <span className="ml-auto text-[10px] text-zinc-500">⌘V</span>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={onCopy} disabled={state.target.selectedIds.length === 0}>
              Copy
              <span className="ml-auto text-[10px] text-zinc-500">⌘C</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPaste}>
              Paste
              <span className="ml-auto text-[10px] text-zinc-500">⌘V</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDuplicate}
              disabled={state.target.selectedIds.length === 0}
            >
              Duplicate
              <span className="ml-auto text-[10px] text-zinc-500">⌘D</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} disabled={state.target.selectedIds.length === 0}>
              Delete
              <span className="ml-auto text-[10px] text-zinc-500">⌫</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={state.target.selectedIds.length === 0 || otherPacks.length === 0}
              >
                Move to pack
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherPacks.map((p) => (
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
