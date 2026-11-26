import { create } from "zustand";

/**
 * Asks for a fresh read of the server's Projects from anywhere: a theme created, renamed or
 * deleted from the Resources' places is read with them again. The pages that load the server
 * index add `count` to their own re-read signal.
 */
export const useServerIndexRereads = create<{ count: number; bump: () => void }>((set) => ({
  count: 0,
  bump: () => set((state) => ({ count: state.count + 1 })),
}));
