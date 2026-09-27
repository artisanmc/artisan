import {
  EDITOR_TOUR_GUEST_KEY,
  EDITOR_TOUR_TRANSFER_KEY,
} from "@/features/onboarding/editorTourStorage";
import { usePersistedDraftStore } from "@/features/project/persistedDrafts";
import type { PersistedDraft } from "@/lib/api/projectDrafts";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { bootstrapDemo } from "./demoLifecycle";
vi.mock("@/state/accountStore", () => ({
  useAccountStore: { getState: () => ({ setAccount: vi.fn() }) },
}));
const session = {
  principal: { kind: "guest" as const, id: "guest" },
  projectId: "demo",
  expiresAt: "later",
  csrfToken: "csrf",
};
test("an explicit new demo can replace expired proof, but reading cannot", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "demo_expired" }), { status: 410 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(bootstrapDemo(false)).rejects.toThrow("demo_expired");
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "demo_expired" }), { status: 410 }),
  );
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(session)));
  expect(await bootstrapDemo(true)).toEqual(session);
  expect(fetcher.mock.calls[2]![1].method).toBe("POST");
});
beforeEach(() => {
  sessionStorage.clear();
  useDemoStore.getState().setSession(session);
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  useProjectDraftStore.setState({ ownerId: "guest", drafts: {}, backups: {}, pendingRenames: {} });
  usePersistedDraftStore.setState({
    sessions: { demo: { ownerId: "guest", drafts: [], status: "saved" } },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useDemoStore.getState().setSession(null);
  localStorage.removeItem(EDITOR_TOUR_GUEST_KEY);
});
