import type { ProjectDraft } from "@/features/project/draft";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type OtherDraft,
  loadOtherDrafts,
  publishOtherDraft,
  snapshotHasChanges,
} from "./otherDrafts";
import { deployOtherDrafts, useOtherDrafts } from "./useOtherDrafts";

const api = vi.hoisted(() => ({
  listServers: vi.fn(),
  listServerProjects: vi.fn(),
  listDrafts: vi.fn(),
  publishDraft: vi.fn(),
  checkDocuments: vi.fn(),
}));
vi.mock("@/lib/api/servers", () => ({ listServers: api.listServers }));
vi.mock("@/lib/api/projectFiles", () => ({ listServerProjects: api.listServerProjects }));
vi.mock("@/lib/api/projectDrafts", () => ({
  listDrafts: api.listDrafts,
  publishDraft: api.publishDraft,
}));
vi.mock("@/lib/api/documentChecks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/documentChecks")>()),
  checkDocuments: api.checkDocuments,
}));

const snapshot = (
  baseline: Record<string, string>,
  tree: Record<string, string>,
): ProjectDraft => ({
  baseline,
  tree,
  at: 0,
});
const draft = (id: string, projectId: string, snap: ProjectDraft) => ({
  id,
  projectId,
  ownerId: "p",
  name: `Draft ${id}`,
  revision: 3,
  status: "active",
  snapshot: snap,
  source: "editor",
  updatedAt: "",
});

describe("other Projects' drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
    api.listServers.mockResolvedValue([
      { id: "s1", label: "lobby", online: true, minecraftVersion: null, lastSeenAt: null },
      { id: "s2", label: "off", online: false, minecraftVersion: null, lastSeenAt: null },
    ]);
    api.listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["s1.shop", "s1.guilds"],
      projects: [
        { id: "s1.shop", name: "shop", hash: "", serverKeyId: "s1" },
        { id: "s1.guilds", name: "guilds", hash: "", serverKeyId: "s1" },
      ],
    });
    api.listDrafts.mockImplementation(async (projectId: string) =>
      projectId === "s1.shop"
        ? [
            draft("working", "s1.shop", snapshot({ "a.yml": "1" }, { "a.yml": "2" })),
            draft("ai", "s1.shop", snapshot({ "a.yml": "1" }, { "a.yml": "3" })),
          ]
        : [
            draft("same", "s1.guilds", snapshot({ "g.yml": "1" }, { "g.yml": "1" })),
            draft("rank", "s1.guilds", snapshot({ "g.yml": "1" }, { "g.yml": "1", "r.yml": "x" })),
          ],
    );
  });

  it("tells a snapshot with changes from one without", () => {
    expect(snapshotHasChanges(snapshot({ a: "1" }, { a: "1" }))).toBe(false);
    expect(snapshotHasChanges(snapshot({ a: "1" }, { a: "2" }))).toBe(true);
    expect(
      snapshotHasChanges({
        ...snapshot({}, {}),
        binaryBaseline: { "i.png": { hash: "h1", size: 1 } },
        binaryTree: { "i.png": { hash: "h2", size: 1 } },
      }),
    ).toBe(true);
  });

  it("does not count a file the editor only reformatted, in a draft saved before it kept them", () => {
    const shipped = 'title: { en: "Buy", fr: "Acheter" }\r\ncan_close: true\r\n';
    const reformatted = "title:\n  en: Buy\n  fr: Acheter\ncan_close: true\n";
    const stale = snapshot({ "dialogs/buy.yml": shipped }, { "dialogs/buy.yml": reformatted });
    expect(snapshotHasChanges(stale)).toBe(false);
    const edited = snapshot(
      { "dialogs/buy.yml": shipped, "menus/shop.yml": "a: 1" },
      { "dialogs/buy.yml": reformatted, "menus/shop.yml": "a: 2" },
    );
    expect(snapshotHasChanges(edited)).toBe(true);
  });

  it("shows a reformatted file of another draft as the server holds it", async () => {
    const shipped = 'title: { en: "Buy" }\r\n';
    api.listDrafts.mockImplementation(async (projectId: string) =>
      projectId === "s1.shop"
        ? [
            draft(
              "old",
              "s1.shop",
              snapshot(
                { "dialogs/buy.yml": shipped, "a.yml": "1" },
                { "dialogs/buy.yml": "title:\n  en: Buy\n", "a.yml": "2" },
              ),
            ),
          ]
        : [],
    );
    const [found] = await loadOtherDrafts(undefined);
    expect(found?.changes.after).toEqual({ "dialogs/buy.yml": shipped, "a.yml": "2" });
  });

  it("lists the drafts with changes on online servers, less the open working copy", async () => {
    const found = await loadOtherDrafts("working");
    expect(api.listServerProjects).toHaveBeenCalledTimes(1);
    expect(found.map((d) => [d.projectName, d.draftId])).toEqual([
      ["guilds", "rank"],
      ["shop", "ai"],
    ]);
    expect(found[0]).toMatchObject({ serverId: "s1", serverLabel: "lobby", revision: 3 });
    expect(found[0]?.changes.after).toEqual({ "g.yml": "1", "r.yml": "x" });
  });

  it("marks a draft this browser has edited further as unsynced", async () => {
    useProjectDraftStore.setState({
      drafts: {
        "s1.guilds": {
          ...snapshot({ "g.yml": "1" }, { "g.yml": "1", "r.yml": "newer" }),
          remote: { id: "rank", name: "Draft rank", revision: 3, ownerId: "p" },
        },
      },
    });
    const found = await loadOtherDrafts(undefined);
    expect(found.find((d) => d.draftId === "rank")?.unsynced).toBe(true);
    expect(found.find((d) => d.draftId === "ai")?.unsynced).toBe(false);
  });

  it("publishes from the hub's copy and clears this browser's copy of the same draft", async () => {
    api.publishDraft.mockResolvedValue({ wrote: 2, draft: {} });
    useProjectDraftStore.setState({
      drafts: {
        "s1.guilds": {
          ...snapshot({}, {}),
          remote: { id: "rank", name: "", revision: 3, ownerId: "p" },
        },
      },
    });
    useProjectBaselineStore.getState().set("s1.guilds", { "g.yml": "1" });
    const [rank] = await loadOtherDrafts(undefined);
    expect(await publishOtherDraft(rank as OtherDraft)).toEqual({ ok: true, wrote: 2 });
    expect(api.publishDraft).toHaveBeenCalledWith("s1.guilds", "rank", 3, expect.any(String));
    expect(useProjectDraftStore.getState().get("s1.guilds")).toBeUndefined();
    expect(useProjectBaselineStore.getState().get("s1.guilds")).toBeUndefined();
  });

  it("deploys one after the other and stops at the first failure", async () => {
    const drafts = ["a", "b", "c"].map((id) => ({ draftId: id, projectName: id }) as OtherDraft);
    const publish = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, wrote: 1 })
      .mockResolvedValueOnce({ ok: false, code: "conflict" });
    const report = await deployOtherDrafts(drafts, publish);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(report.deployed.map((d) => d.draftId)).toEqual(["a"]);
    expect(report.failed).toMatchObject({ code: "conflict", draft: { draftId: "b" } });
    expect(report.skipped.map((d) => d.draftId)).toEqual(["c"]);
  });

  it("picks the preselected drafts, one per Project, and checks each picked one", async () => {
    api.checkDocuments.mockResolvedValue([]);
    const { result } = renderHook(() => useOtherDrafts());
    act(() => result.current.load(undefined, ["ai", "working"]));
    await waitFor(() => expect(result.current.state?.status).toBe("ready"));
    const state = () =>
      result.current.state as Extract<typeof result.current.state, { status: "ready" }>;
    // Both are drafts of shop: only the first listed is picked.
    expect(state().selected).toHaveLength(1);
    await waitFor(() => expect(Object.values(state().checks)[0]?.status).toBe("ready"));

    act(() => result.current.toggle("rank"));
    expect(state().selected).toContain("rank");
    const shopPicked = state().selected.find((id) => id !== "rank") as string;
    const otherShop = shopPicked === "ai" ? "working" : "ai";
    act(() => result.current.toggle(otherShop));
    expect(state().selected).toEqual(expect.arrayContaining(["rank", otherShop]));
    expect(state().selected).not.toContain(shopPicked);

    act(() => result.current.unselectProject("s1.guilds"));
    expect(state().selected).toEqual([otherShop]);
  });
});
