import { create } from "zustand";

// Presentation only: no persisted preferences, documents or selection are changed.
export const useTourPresentation = create<{ step: number | null }>(() => ({ step: null }));
