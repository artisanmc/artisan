import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchItems } from "./projectApi";

describe("fetchItems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed LibraryData on success", async () => {
    const mockData = {
      version: "1.21.4",
      items: [
        { id: "diamond_sword", label: "Diamond Sword", category: "combat", texture: "item/diamond_sword" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    }));

    const result = await fetchItems("test-token");
    expect(result.version).toBe("1.21.4");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("diamond_sword");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchItems("test-token")).rejects.toThrow("503");
  });
});
