import type { ProjectId } from "@/domain/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LibraryCategory = "items" | "captured" | "image-buttons";

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
      open: (projectId, category) =>
        set((state) => ({ projectId, category: category ?? state.category })),
      close: () => set({ projectId: null }),
      setCategory: (category) => set({ category }),
    }),
    {
      name: "artisan-library-size",
      version: 1,
      migrate: (
        persisted,
      ): Pick<ProjectLibraryState, "width" | "height" | "projectId" | "category"> => {
        const state = persisted as Partial<ProjectLibraryState>;
        return {
          width: state.width ?? 340,
          height: state.height ?? 280,
          projectId: state.projectId ?? null,
          category:
            state.category === "captured" || state.category === "image-buttons"
              ? state.category
              : "items",
        };
      },
      partialize: (state) => ({
        width: state.width,
        height: state.height,
        projectId: state.projectId,
        category: state.category,
      }),
    },
  ),
);
