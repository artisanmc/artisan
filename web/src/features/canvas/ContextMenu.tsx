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

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  /** Selection at the moment the menu opened — actions read from this snapshot. */
  selectedIds: string[];
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
}: ContextMenuProps) {
  // Subscribe to the packs array (stable ref until mutation), then filter
  // in a memo. A naive selector that returns `.filter(...)` would create a
  // new array on every render and infinite-loop Zustand's notify cycle.
  const packs = useAccountStore((s) => s.account.packs);
  const otherPacks = useMemo(() => packs.filter((p) => p.id !== packId), [packs, packId]);
  const hasSelection = state.selectedIds.length > 0;

  return (
    <DropdownMenu open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{ position: "fixed", left: state.x, top: state.y, width: 1, height: 1 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2}>
        <DropdownMenuItem onSelect={onCopy} disabled={!hasSelection}>
          Copy
          <span className="ml-auto text-[10px] text-zinc-500">⌘C</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPaste}>
          Paste
          <span className="ml-auto text-[10px] text-zinc-500">⌘V</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate} disabled={!hasSelection}>
          Duplicate
          <span className="ml-auto text-[10px] text-zinc-500">⌘D</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} disabled={!hasSelection}>
          Delete
          <span className="ml-auto text-[10px] text-zinc-500">⌫</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!hasSelection || otherPacks.length === 0}>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { ContextMenuState };
