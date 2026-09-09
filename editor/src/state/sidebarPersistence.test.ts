import type { ProjectId } from "@/domain/types";
import { useProjectLibraryStore } from "@/features/project/projectLibraryStore";
import { beforeEach, expect, it } from "vitest";
import { useSidebarStore } from "./sidebarStore";
import { useUiStore } from "./uiStore";

beforeEach(() => {
  localStorage.clear();
  useSidebarStore.setState({ pinned: false, isOpen: false });
  useUiStore.setState({ projectPanelOpen: false });
  useProjectLibraryStore.setState({ projectId: null, category: "items" });
});

it("restores the fixed navigation choice without reopening the mobile drawer", async () => {
  useSidebarStore.getState().togglePinned();
  useSidebarStore.getState().open();
  const saved = localStorage.getItem("artisan-navigation");
  expect(saved).not.toBeNull();
  useSidebarStore.setState({ pinned: false, isOpen: false });
  localStorage.setItem("artisan-navigation", saved!);
  await useSidebarStore.persist.rehydrate();
  expect(useSidebarStore.getState().pinned).toBe(true);
  expect(useSidebarStore.getState().isOpen).toBe(false);
});

it("restores both open and closed Elements choices", async () => {
  const name = useUiStore.persist.getOptions().name;
  for (const open of [true, false]) {
    useUiStore.getState().setProjectPanelOpen(open);
    const saved = localStorage.getItem(name)!;
    useUiStore.setState({ projectPanelOpen: !open });
    localStorage.setItem(name, saved);
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().projectPanelOpen).toBe(open);
  }
});

it("restores the library project and category, then remembers closing it", async () => {
  const name = useProjectLibraryStore.persist.getOptions().name;
  const projectId = "project-a" as ProjectId;
  useProjectLibraryStore.getState().open(projectId, "graphics");
  const saved = localStorage.getItem(name)!;
  useProjectLibraryStore.setState({ projectId: null, category: "items" });
  localStorage.setItem(name, saved);
  await useProjectLibraryStore.persist.rehydrate();
  expect(useProjectLibraryStore.getState()).toMatchObject({ projectId, category: "graphics" });
  useProjectLibraryStore.getState().close();
  const closed = localStorage.getItem(name)!;
  useProjectLibraryStore.setState({ projectId });
  localStorage.setItem(name, closed);
  await useProjectLibraryStore.persist.rehydrate();
  expect(useProjectLibraryStore.getState().projectId).toBeNull();
});
