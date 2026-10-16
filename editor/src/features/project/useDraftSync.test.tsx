import { menusOf } from "@/domain/documents";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDirty } from "./draft";
import { projectTree } from "./saveProjectToDisk";
import { useDraftSync } from "./useDraftSync";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  useProjectBaselineStore.setState({ baselines: {} });
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const openProjects = structuredClone(useProjectsStore.getState().openProjects);
  const project = openProjects.projects[0]!;
  const initialTree = projectTree(project);
  useProjectBaselineStore.getState().set(project.id, initialTree);
  return { openProjects, project, initialTree };
}

describe("browser draft retention", () => {
  it("marks the first file-shape change after saving as dirty, and clears it on revert", () => {
    const { project, initialTree } = setup();
    // Saving clears the browser draft but retains the exact saved baseline.
    renderHook(() => useDraftSync());
    act(() => {
      useProjectsStore.getState().setProjectI18nMode({ projectId: project.id, mode: "inline" });
      vi.advanceTimersByTime(250);
    });
    const draft = useProjectDraftStore.getState().get(project.id)!;
    expect(draft.tree).not.toEqual(initialTree);
    expect(isDirty(draft.initialTree, draft.tree)).toBe(true);
    expect(draft.initialTree).toEqual(initialTree);
    act(() => {
      useProjectsStore.getState().setProjectI18nMode({ projectId: project.id, mode: "extract" });
      vi.advanceTimersByTime(250);
    });
    const reverted = useProjectDraftStore.getState().get(project.id)!;
    expect(isDirty(reverted.initialTree, reverted.tree)).toBe(false);
  });

  it("keeps a restored draft dirty after serialization and another refresh", () => {
    const { openProjects, project, initialTree } = setup();
    project.name = "Edited project";
    menusOf(project)[0]!.rows = 5;
    project.canvasLayout = { [menusOf(project)[0]!.id]: { x: 321, y: 456 } };
    const tree = projectTree(project);
    // A browser reload hydrates JSON: equal file trees are different objects.
    useProjectDraftStore.getState().save(
      project.id,
      JSON.parse(
        JSON.stringify({
          baseline: initialTree,
          initialTree,
          tree,
          at: 123,
        }),
      ),
    );
    const hook = renderHook(() => useDraftSync());
    act(() => {
      useProjectsStore.getState().setOpenProjects(openProjects);
      vi.advanceTimersByTime(250);
    });
    const draft = useProjectDraftStore.getState().get(project.id)!;
    expect(isDirty(draft.initialTree, draft.tree)).toBe(true);
    expect(draft.initialTree).toEqual(initialTree);
    expect(draft.tree).toEqual(tree);
    expect(draft.at).toBe(123);
    hook.unmount();
  });

  it("does not mark load-time file normalization as an edit", () => {
    const { openProjects, project, initialTree } = setup();
    useProjectBaselineStore.getState().set(project.id, {
      ...initialTree,
      "manifest.yaml": `# Written by hand\n${initialTree["manifest.yaml"]}`,
    });
    renderHook(() => useDraftSync());
    act(() => {
      useProjectsStore.getState().setOpenProjects(openProjects);
      vi.advanceTimersByTime(250);
    });
    const draft = useProjectDraftStore.getState().get(project.id)!;
    expect(isDirty(draft.baseline, draft.tree)).toBe(true);
    expect(isDirty(draft.initialTree, draft.tree)).toBe(false);
  });

  it("flushes pending edits when the page is hidden before the debounce", () => {
    const { openProjects, project, initialTree } = setup();
    useProjectDraftStore.getState().save(project.id, {
      baseline: initialTree,
      initialTree,
      tree: initialTree,
      at: 123,
    });
    renderHook(() => useDraftSync());
    project.name = "Last edit before refresh";
    menusOf(project)[0]!.rows = 5;
    project.canvasLayout = { [menusOf(project)[0]!.id]: { x: 321, y: 456 } };
    act(() => {
      useProjectsStore.getState().setOpenProjects(openProjects);
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(useProjectDraftStore.getState().get(project.id)!.tree).toEqual(projectTree(project));
  });

  it("resets the dirty reference when the server baseline actually changes", () => {
    const { openProjects, project, initialTree } = setup();
    useProjectDraftStore.getState().save(project.id, {
      baseline: initialTree,
      initialTree,
      tree: initialTree,
      at: 123,
    });
    renderHook(() => useDraftSync());
    menusOf(project)[0]!.rows = 5;
    const savedTree = projectTree(project);
    act(() => {
      useProjectBaselineStore.getState().set(project.id, savedTree);
      useProjectsStore.getState().setOpenProjects(openProjects);
      vi.advanceTimersByTime(250);
    });
    const draft = useProjectDraftStore.getState().get(project.id)!;
    expect(draft.initialTree).toEqual(savedTree);
    expect(isDirty(draft.initialTree, draft.tree)).toBe(false);
  });
});
