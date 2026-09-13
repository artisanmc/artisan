import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { onProjectRenamed } from "./onProjectRenamed";
import { projectTree } from "./saveProjectToDisk";
import { useDraftSync } from "./useDraftSync";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("flushes pending edits and preserves draft identity while rebinding a renamed folder", () => {
  vi.useFakeTimers();
  const account = mockAccount();
  const project = account.projects[0]!;
  project.diskId = "old_folder";
  project.serverKeyId = "server";
  useAccountStore.getState().setAccount(account);
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
    useAccountStore.getState().setProjectI18nMode({ projectId: project.id, mode: "inline" });
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
  expect(useAccountStore.getState().account.projects[0]?.diskId).toBe("new_folder");
  expect(useProjectCacheStore.getState().entries.cached?.diskId).toBe("new_folder");
  expect(useProjectCacheStore.getState().entries.cached?.hash).toBeNull();
  expect(useProjectCacheStore.getState().reloadToken).toBe(1);
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(useProjectDraftStore.getState().get(project.id)?.tree).toEqual(draft.tree);
  expect(useProjectDraftStore.getState().get(project.id)?.baseline).toEqual(baseline);
});
