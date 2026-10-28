import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { onProjectRenamed } from "./onProjectRenamed";
import { projectTree } from "./saveProjectToDisk";
import { useDraftSync } from "./useDraftSync";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["atelier", "Mon atelier créatif"])(
  "updates the default name but preserves a custom name: %s",
  (name) => {
    const openProjects = mockOpenProjects();
    const project = openProjects.projects[0]!;
    Object.assign(project, { name, diskId: "atelier", serverKeyId: "server" });
    useProjectsStore.getState().setOpenProjects(openProjects);
    useProjectCacheStore.setState({
      entries: {
        cached: {
          identity: { project: { id: project.id, name, externalId: "atelier" } },
          diskId: "atelier",
          serverKeyId: "server",
          tree: {},
          hash: "old",
          fetchedAt: "yesterday",
        },
      },
    });
    onProjectRenamed({
      projectId: project.id,
      serverKeyId: "server",
      previousDiskId: "atelier",
      diskId: "principal",
    });
    const expected = name === "atelier" ? "principal" : name;
    expect(useProjectsStore.getState().openProjects.projects[0]?.name).toBe(expected);
    expect(useProjectCacheStore.getState().entries.cached?.identity).toMatchObject({
      project: { name: expected },
    });
  },
);

it("flushes pending edits and preserves draft identity while rebinding a renamed folder", () => {
  vi.useFakeTimers();
  const openProjects = mockOpenProjects();
  const project = openProjects.projects[0]!;
  project.diskId = "old_folder";
  project.serverKeyId = "server";
  useProjectsStore.getState().setOpenProjects(openProjects);
  const baseline = projectTree(project);
  useProjectBaselineStore.setState({ baselines: { [project.id]: baseline } });
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
  useProjectCacheStore.setState({
    entries: {
      cached: {
        identity: { project: { id: project.id, externalId: "old_folder" } },
        diskId: "old_folder",
        serverKeyId: "server",
        tree: baseline,
        hash: "old",
        fetchedAt: "yesterday",
      },
    },
    reloadToken: 0,
  });
  renderHook(() => useDraftSync());
  act(() => {
    useProjectsStore.getState().addLanguage({ projectId: project.id, lang: "de" });
    onProjectRenamed({
      serverKeyId: "server",
      projectId: project.id,
      previousDiskId: "old_folder",
      diskId: "new_folder",
    });
  });
  const draft = useProjectDraftStore.getState().get(project.id)!;
  expect(draft.tree).not.toEqual(baseline);
  expect(draft.initialTree).toEqual(baseline);
  expect(useProjectsStore.getState().openProjects.projects[0]?.diskId).toBe("new_folder");
  expect(useProjectCacheStore.getState().entries.cached?.diskId).toBe("new_folder");
  expect(useProjectCacheStore.getState().entries.cached?.hash).toBeNull();
  expect(useProjectCacheStore.getState().reloadToken).toBe(1);
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(useProjectDraftStore.getState().get(project.id)?.tree).toEqual(draft.tree);
  expect(useProjectDraftStore.getState().get(project.id)?.baseline).toEqual(baseline);
});
