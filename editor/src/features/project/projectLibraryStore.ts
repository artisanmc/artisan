import type { ProjectId } from "@/domain/types";
import { create } from "zustand";

export type LibraryCategory = "items" | "graphics";

interface ProjectLibraryState {
  projectId: ProjectId | null;
  category: LibraryCategory;
  open: (projectId: ProjectId, category?: LibraryCategory) => void;
  close: () => void;
  setCategory: (category: LibraryCategory) => void;
}

export const useProjectLibraryStore = create<ProjectLibraryState>((set) => ({
  projectId: null,
  category: "items",
  open: (projectId, category = "items") => set({ projectId, category }),
  close: () => set({ projectId: null }),
  setCategory: (category) => set({ category }),
}));
