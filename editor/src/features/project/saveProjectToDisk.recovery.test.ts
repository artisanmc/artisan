import type { Project } from "@/domain/types";
import * as api from "@/lib/api/projectDrafts";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, expect, it, vi } from "vitest";
import { loadPersistedDrafts, usePersistedDraftStore } from "./persistedDrafts";
import { projectTree, saveProjectToDisk } from "./saveProjectToDisk";

vi.mock("@/lib/api/projectDrafts", async (original) => ({
  ...(await original<typeof api>()),
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  publishDraft: vi.fn(),
}));

function project(name: string): Project {
  return {
    id: "p1",
    name,
    documents: {
      menu: [{ id: "menu", projectId: "p1", rows: 3, title: [], notes: name, layers: [] }],
      command: [],
      dialog: [],
    },
    i18nKeys: {},
    translations: {},
    dataSources: [],
    dataModels: [],
    itemTemplates: [],
    canvasLayout: [],
  } as unknown as Project;
}

beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ currentUser: { id: "u1" } as never });
  useProjectBaselineStore.setState({ baselines: {}, binaryBaselines: {} });
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
  usePersistedDraftStore.setState({ sessions: {} });
});

it.each(["latest", "editing", "failure", "unchanged"])(
  "recovers a lost publish response and handles %s work",
  async (scenario) => {
    const first = project("First");
    const latest = scenario === "unchanged" ? first : project("Latest");
    const baseline = projectTree(project("Original"));
    const firstTree = projectTree(first);
    const latestTree = projectTree(latest);
    const laterTree = projectTree(project("Typed during publication"));
    useProjectBaselineStore.getState().set("p1", baseline);
    const original: api.PersistedDraft = {
      id: "d1",
      projectId: "p1",
      ownerId: "u1",
      name: "Draft",
      revision: 1,
      status: "active",
      source: "editor",
      updatedAt: "today",
      snapshot: { baseline, tree: firstTree, initialTree: baseline, at: 123 },
    };
    const drafts = new Map([[original.id, original]]);
    let deployed = baseline;
    vi.mocked(api.listDrafts).mockResolvedValue([original]);
    vi.mocked(api.createDraft).mockImplementation(async (projectId, id, name, snapshot) => {
      const draft = { ...original, projectId, id, name, snapshot };
      drafts.set(id, draft);
      return draft;
    });
    vi.mocked(api.updateDraft).mockImplementation(
      async (_projectId, id, revision, name, snapshot) => {
        const draft = { ...original, id, revision: revision + 1, name, snapshot };
        drafts.set(id, draft);
        return draft;
      },
    );
    const receipts = new Map<string, { draft: api.PersistedDraft; wrote: number }>();
    vi.mocked(api.publishDraft).mockImplementation(
      async (_projectId, id, _revision, operationId) => {
        const previous = receipts.get(operationId);
        if (previous) return previous;
        if (receipts.size === 1 && scenario === "failure") throw new Error("network_error");
        const draft = { ...drafts.get(id)!, status: "published" };
        deployed = draft.snapshot.tree;
        const receipt = { draft, wrote: 1 };
        receipts.set(operationId, receipt);
        if (receipts.size === 1) throw new Error("signal timed out");
        if (scenario === "editing") {
          useProjectDraftStore.getState().save("p1", {
            ...useProjectDraftStore.getState().get("p1")!,
            tree: laterTree,
          });
        }
        return receipt;
      },
    );
    await loadPersistedDrafts("p1", "u1");
    expect(await saveProjectToDisk(first)).toMatchObject({ ok: false });
    expect(deployed).toEqual(firstTree);
    const result = await saveProjectToDisk(latest);
    if (scenario === "failure") {
      expect(result).toMatchObject({ ok: false, code: "network_error" });
      expect(deployed).toEqual(firstTree);
      expect(useProjectBaselineStore.getState().get("p1")).toEqual(firstTree);
      expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(latestTree);
      return;
    }
    expect(result).toMatchObject({ ok: true });
    expect(deployed).toEqual(latestTree);
    expect(useProjectBaselineStore.getState().get("p1")).toEqual(latestTree);
    if (scenario === "editing") {
      expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(laterTree);
      expect(useProjectDraftStore.getState().get("p1")?.baseline).toEqual(latestTree);
    } else expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
    const calls = vi.mocked(api.publishDraft).mock.calls;
    expect(calls[1]).toEqual(calls[0]);
    if (scenario === "unchanged") expect(calls).toHaveLength(2);
    else {
      expect(calls).toHaveLength(3);
      expect(calls[2]?.[3]).not.toBe(calls[0]?.[3]);
    }
  },
);
