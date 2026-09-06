import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDirty } from "./draft";
import { projectTree } from "./saveProjectToDisk";
import { useDraftSync } from "./useDraftSync";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useAccountStore.setState({ account: mockAccount() });
  useProjectBaselineStore.setState({ baselines: {} });
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const account = structuredClone(useAccountStore.getState().account);
  const project = account.projects[0]!;
  const initialTree = projectTree(project);
  useProjectBaselineStore.getState().set(project.id, initialTree);
  return { account, project, initialTree };
}

describe("browser draft retention", () => {
  it("keeps a restored draft dirty after serialization and another refresh", () => {
    const { account, project, initialTree } = setup();
    project.name = "Edited project";
    project.menus[0]!.rows = 5;
    project.canvasLayout = { [project.menus[0]!.id]: { x: 321, y: 456 } };
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
      useAccountStore.getState().setAccount(account);
      vi.advanceTimersByTime(250);
    });
    const draft = useProjectDraftStore.getState().get(project.id)!;
    expect(isDirty(draft.initialTree, draft.tree)).toBe(true);
    expect(draft.initialTree).toEqual(initialTree);
    expect(draft.tree).toEqual(tree);
    expect(draft.at).toBe(123);
    hook.unmount();
  });

  it("flushes pending edits when the page is hidden before the debounce", () => {
    const { account, project, initialTree } = setup();
    useProjectDraftStore.getState().save(project.id, {
      baseline: initialTree,
      initialTree,
      tree: initialTree,
      at: 123,
    });
    renderHook(() => useDraftSync());
    project.name = "Last edit before refresh";
    project.menus[0]!.rows = 5;
    project.canvasLayout = { [project.menus[0]!.id]: { x: 321, y: 456 } };
    act(() => {
      useAccountStore.getState().setAccount(account);
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(useProjectDraftStore.getState().get(project.id)!.tree).toEqual(projectTree(project));
  });

  it("resets the dirty reference when the server baseline actually changes", () => {
    const { account, project, initialTree } = setup();
    useProjectDraftStore.getState().save(project.id, {
      baseline: initialTree,
      initialTree,
      tree: initialTree,
      at: 123,
    });
    renderHook(() => useDraftSync());
    project.menus[0]!.rows = 5;
    const savedTree = projectTree(project);
    act(() => {
      useProjectBaselineStore.getState().set(project.id, savedTree);
      useAccountStore.getState().setAccount(account);
      vi.advanceTimersByTime(250);
    });
    const draft = useProjectDraftStore.getState().get(project.id)!;
    expect(draft.initialTree).toEqual(savedTree);
    expect(isDirty(draft.initialTree, draft.tree)).toBe(false);
  });
});
