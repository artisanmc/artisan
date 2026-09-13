import { syncPersistedDraft, waitForDraftWrites } from "@/features/project/persistedDrafts";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, expect, test, vi } from "vitest";
import { prepareDemoAuthentication } from "./demoLifecycle";
vi.mock("@/features/project/persistedDrafts", () => ({
  waitForDraftWrites: vi.fn(),
  syncPersistedDraft: vi.fn(),
  usePersistedDraftStore: {
    getState: () => ({ sessions: { demo: { ownerId: "guest", status: "saved" } } }),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  useAuthStore.setState({ currentUser: null });
  useDemoStore.getState().setSession({
    principal: { kind: "guest", id: "guest" },
    projectId: "demo",
    csrfToken: "csrf",
    expiresAt: "2099-01-01",
  });
  useProjectDraftStore.setState({
    ownerId: "guest",
    drafts: { demo: { baseline: {}, tree: { "menus/menu.yaml": "typing" }, at: 1 } },
  });
});
test("authentication waits for asset writes and confirms the draft first", async () => {
  let release!: () => void;
  vi.mocked(waitForDraftWrites).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const prepare = prepareDemoAuthentication();
  expect(syncPersistedDraft).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("artisan:demo-auth-return")).toBeNull();
  release();
  expect(await prepare).toBe("/demo/projects/demo");
  expect(syncPersistedDraft).toHaveBeenCalledTimes(2);
  expect(useProjectDraftStore.getState().get("demo")?.tree).toEqual({
    "menus/menu.yaml": "typing",
  });
});
test("unconfirmed asset retry prevents leaving for authentication and preserves the draft", async () => {
  vi.mocked(waitForDraftWrites).mockRejectedValueOnce(new Error("asset_pending"));
  await expect(prepareDemoAuthentication()).rejects.toThrow("asset_pending");
  expect(sessionStorage.getItem("artisan:demo-auth-return")).toBeNull();
  expect(useProjectDraftStore.getState().get("demo")?.tree).toEqual({
    "menus/menu.yaml": "typing",
  });
});
