import { create } from "zustand";

/**
 * The variant the editor shows the modules as ("View as"). Variants are the server's, not a
 * module's: the pick follows the editor from one module to the next (`useVariantInUrl` shows it
 * in each module that has it), and a module without it shows its own Documents meanwhile.
 */
export const useViewAsStore = create<{
  variant: string | undefined;
  set: (variant: string | undefined) => void;
}>((set) => ({ variant: undefined, set: (variant) => set({ variant }) }));
