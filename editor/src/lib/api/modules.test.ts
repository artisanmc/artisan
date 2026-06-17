import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchActiveModules } from "./modules";

afterEach(() => vi.restoreAllMocks());

describe("fetchActiveModules", () => {
  it("calls the session modules endpoint with the token in the path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ modules: [{ id: "quests", version: "1.0.0" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchActiveModules("tok123");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/editor-session/tok123/modules"),
    );
    expect(result).toEqual([{ id: "quests", version: "1.0.0" }]);
  });

  it("returns [] on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchActiveModules("bad")).toEqual([]);
  });
});
