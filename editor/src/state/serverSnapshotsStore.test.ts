import { beforeEach, describe, expect, it, vi } from "vitest";

const previewDataSource = vi.fn();
vi.mock("@/lib/api/dataSources", () => ({
  previewDataSource: (...args: unknown[]) => previewDataSource(...args),
}));

const { useServerSnapshotsStore } = await import("./serverSnapshotsStore");

const load = (params?: Record<string, string>) =>
  useServerSnapshotsStore
    .getState()
    .loadSnapshot({ networkId: "n1", serverId: "s1", ref: "msquests:quests", params });

const rows = () => useServerSnapshotsStore.getState().rowsByRef["msquests:quests"];

describe("serverSnapshotsStore", () => {
  beforeEach(() => {
    useServerSnapshotsStore.getState().clear();
    previewDataSource.mockReset();
  });

  it("fetches once for the same params, however many renders ask", async () => {
    previewDataSource.mockResolvedValue({ ok: true, rows: [{ id: "a" }], truncated: false });

    await load({ player: "Steve" });
    await load({ player: "Steve" });

    expect(previewDataSource).toHaveBeenCalledTimes(1);
  });

  /**
   * The bug this guards: `rowsByRef` is keyed by ref alone, so previewing as a
   * second player overwrites the first one's rows. Coming back to the first
   * player must refetch — a dedupe that only remembers "already asked" would
   * leave the wrong player's rows on screen for good.
   */
  it("refetches when the params change back to a previously seen value", async () => {
    previewDataSource
      .mockResolvedValueOnce({ ok: true, rows: [{ id: "steve" }], truncated: false })
      .mockResolvedValueOnce({ ok: true, rows: [{ id: "nobody" }], truncated: false })
      .mockResolvedValueOnce({ ok: true, rows: [{ id: "steve" }], truncated: false });

    await load({ player: "Steve" });
    expect(rows()).toEqual([{ id: "steve" }]);

    await load({ player: "Typo" });
    expect(rows()).toEqual([{ id: "nobody" }]);

    await load({ player: "Steve" });
    expect(previewDataSource).toHaveBeenCalledTimes(3);
    expect(rows()).toEqual([{ id: "steve" }]);
  });

  it("passes the params through to the fetch", async () => {
    previewDataSource.mockResolvedValue({ ok: true, rows: [], truncated: false });

    await load({ group: "daily", player: "Steve" });

    expect(previewDataSource).toHaveBeenCalledWith("n1", "s1", {
      ref: "msquests:quests",
      params: { group: "daily", player: "Steve" },
    });
  });

  it("retries after a failure instead of caching the error", async () => {
    previewDataSource
      .mockResolvedValueOnce({ ok: false, error: "fetch_timeout", message: null })
      .mockResolvedValueOnce({ ok: true, rows: [{ id: "a" }], truncated: false });

    await load({ player: "Steve" });
    expect(rows()).toBeUndefined();

    await load({ player: "Steve" });
    expect(rows()).toEqual([{ id: "a" }]);
  });

  it("never fetches a project-owned source", async () => {
    await useServerSnapshotsStore
      .getState()
      .loadSnapshot({ networkId: "n1", serverId: "s1", ref: "pack:ranks" });

    expect(previewDataSource).not.toHaveBeenCalled();
  });
});
