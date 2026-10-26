import type { Project, ProjectId } from "@/domain/types";
import { OPEN_DEPLOY_REVIEW } from "@/features/project/ProjectHistory";
import { saveProjectToDisk } from "@/features/project/saveProjectToDisk";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublishFlow } from "./usePublishFlow";

vi.mock("@/features/project/saveProjectToDisk", async () => {
  const actual = await vi.importActual<typeof import("@/features/project/saveProjectToDisk")>(
    "@/features/project/saveProjectToDisk",
  );
  return { ...actual, saveProjectToDisk: vi.fn() };
});

const ID = "p1" as ProjectId;

function project(): Project {
  return {
    id: ID,
    diskId: "p1",
    name: "Shop",
    source: "user_created",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    defaultLang: "en",
    i18nKeys: {},
    documents: { menu: [], command: [], dialog: [] },
    assets: [],
    dataSources: [],
    canvasLayout: {},
  };
}

const conflict = { path: "menus/shop.yml", disk: "title: Server\n" };

beforeEach(() => {
  vi.mocked(saveProjectToDisk).mockReset();
  useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
  useProjectsStore.setState({
    openProjects: { projects: [project()], projectOrder: [ID] },
  } as never);
  useProjectDraftStore.getState().save(ID, {
    baseline: {},
    initialTree: {},
    tree: { "artisan-module.yml": "changed" },
    at: 0,
  });
});

afterEach(() => {
  useProjectDraftStore.getState().clear(ID);
  useProjectBaselineStore.getState().set(ID, {});
});

describe("usePublishFlow", () => {
  it("reviews before deploying, and a failure keeps its details for the dialog", async () => {
    vi.mocked(saveProjectToDisk).mockResolvedValueOnce({
      ok: false,
      error: "write_error",
      status: 422,
      message: "AccessDeniedException",
    });
    const { result } = renderHook(() => usePublishFlow(ID, false));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(true);
    act(() => result.current.openReview());
    expect(result.current.state.review?.changes.after).toHaveProperty("artisan-module.yml");
    expect(saveProjectToDisk).not.toHaveBeenCalled();
    act(() => result.current.confirmReview());
    await waitFor(() => expect(result.current.state.errorOpen).toBe(true));
    expect(result.current.state.review).toBeNull();
    expect(result.current.state.saving).toBe(false);
    expect(result.current.state.lastError).toContain("AccessDeniedException");
    expect(result.current.state.lastError).toContain("HTTP 422");
  });

  it("a deploy refused by the server's check lists each document that would not load", async () => {
    vi.mocked(saveProjectToDisk).mockResolvedValueOnce({
      ok: false,
      error: "write_error",
      code: "invalid_documents",
      status: 422,
      message:
        "menus/vip.yml: unknown property 'tittle'\ncommands/shop.yml: required property 'name'",
    });
    const { result } = renderHook(() => usePublishFlow(ID, false));
    act(() => result.current.openReview());
    act(() => result.current.confirmReview());
    await waitFor(() => expect(result.current.state.errorOpen).toBe(true));
    expect(result.current.state.lastError).toContain("Rien n’a été déployé");
    expect(result.current.state.lastError).toContain("menus/vip.yml: unknown property 'tittle'");
    expect(result.current.state.lastError).toContain("commands/shop.yml: required property 'name'");
  });

  it("opens no review while the server is offline", () => {
    const { result } = renderHook(() => usePublishFlow(ID, true));
    act(() => result.current.openReview());
    expect(result.current.state.review).toBeNull();
  });

  it("opens the review from the History tab's restore event", () => {
    const { result } = renderHook(() => usePublishFlow(ID, false));
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_DEPLOY_REVIEW, { detail: { projectId: "other" } }));
    });
    expect(result.current.state.review).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_DEPLOY_REVIEW, { detail: { projectId: ID } }));
    });
    expect(result.current.state.review).not.toBeNull();
  });

  it("asks file by file on a CAS conflict, then keeping mine moves the base and retries", async () => {
    vi.mocked(saveProjectToDisk)
      .mockResolvedValueOnce({
        ok: false,
        error: "conflict",
        conflicts: [conflict],
        diskFiles: ["menus/shop.yml"],
      })
      .mockResolvedValueOnce({ ok: true, wrote: 1 });
    const { result } = renderHook(() => usePublishFlow(ID, false));
    act(() => result.current.confirmReview());
    await waitFor(() => expect(result.current.state.conflict.conflicts).toEqual([conflict]));
    expect(result.current.state.conflict).toMatchObject({
      source: "save",
      diskFiles: ["menus/shop.yml"],
      choices: {},
    });

    act(() => result.current.chooseConflict(conflict.path, "mine"));
    await act(() => result.current.applyConflicts());

    // "Mine" adopts nothing: the base now matches the disk and the deploy reruns.
    expect(useProjectBaselineStore.getState().get(ID)).toMatchObject({
      [conflict.path]: conflict.disk,
    });
    expect(saveProjectToDisk).toHaveBeenCalledTimes(2);
    expect(result.current.state.conflict.conflicts).toEqual([]);
  });

  it("takes the server's file into the editor without redeploying", async () => {
    vi.mocked(saveProjectToDisk).mockResolvedValueOnce({
      ok: false,
      error: "conflict",
      conflicts: [conflict],
      diskFiles: [],
    });
    const { result } = renderHook(() => usePublishFlow(ID, false));
    act(() => result.current.confirmReview());
    await waitFor(() => expect(result.current.state.conflict.conflicts).toHaveLength(1));
    act(() => result.current.chooseConflict(conflict.path, "disk"));
    await act(() => result.current.applyConflicts());
    expect(saveProjectToDisk).toHaveBeenCalledTimes(1);
    expect(result.current.state.conflict.conflicts).toEqual([]);
  });
});
