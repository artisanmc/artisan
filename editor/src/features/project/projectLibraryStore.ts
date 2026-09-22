import type { ProjectId } from "@/domain/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LibraryCategory = "items" | "graphics" | "image-buttons";

interface ProjectLibraryState {
  width: number;
  height: number;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  projectId: ProjectId | null;
  category: LibraryCategory;
  open: (projectId: ProjectId, category?: LibraryCategory) => void;
  close: () => void;
  setCategory: (category: LibraryCategory) => void;
}

export const useProjectLibraryStore = create<ProjectLibraryState>()(
  persist(
    (set) => ({
      width: 340,
      height: 280,
      setWidth: (width) => set({ width }),
      setHeight: (height) => set({ height }),
      projectId: null,
      category: "items",
      open: (projectId, category = "items") => set({ projectId, category }),
      close: () => set({ projectId: null }),
      setCategory: (category) => set({ category }),
    }),
    {
      name: "artisan-library-size",
      partialize: (state) => ({
        width: state.width,
        height: state.height,
        projectId: state.projectId,
        category: state.category,
      }),
    },
  ),
);
