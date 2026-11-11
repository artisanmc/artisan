import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchActiveModulesUser } from "./modules";

afterEach(() => vi.restoreAllMocks());

describe("fetchActiveModulesUser", () => {
  it("calls the user-scoped modules endpoint with credentials included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ modules: [{ id: "quests", version: "1.0.0" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchActiveModulesUser("srv1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/servers/srv1/modules"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(result).toEqual([{ id: "quests", version: "1.0.0" }]);
  });

  it("returns [] on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchActiveModulesUser("srv1")).toEqual([]);
  });
});
