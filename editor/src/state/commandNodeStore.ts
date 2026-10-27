import type { CommandId, CommandNodePath } from "@/domain/types";
import { create } from "zustand";

interface CommandNodeState {
  /** The command whose node the inspector edits, and the node's path (`[]` is the root). */
  id: CommandId | null;
  path: CommandNodePath;
  select: (id: CommandId, path: CommandNodePath) => void;
}

/**
 * The command node (the command or one of its sub-commands) the inspector edits. Shared so
 * a click on a sub-command's row on the board opens the inspector on it. Ephemeral, like
 * the selection: outside projectsStore and its undo history.
 */
export const useCommandNodeStore = create<CommandNodeState>((set) => ({
  id: null,
  path: [],
  select: (id, path) => set({ id, path }),
}));
