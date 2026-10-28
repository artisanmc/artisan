import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectCacheStore } from "./projectCacheStore";

const entry = (fetchedAt: string) => ({
  identity: {},
  diskId: "d",
  tree: { "a.yaml": "x".repeat(10) },
  fetchedAt,
});

afterEach(() => {
  vi.restoreAllMocks();
  useProjectCacheStore.setState({ entries: {}, reloadToken: 0 } as never);
});

describe("projectCacheStore persistence", () => {
  it("a full storage never fails a put: the oldest versions are left out of it", () => {
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      // Room for two entries at most.
      if (key === "artisan.project-cache" && (value.match(/"fetchedAt"/g) ?? []).length > 2)
        throw new DOMException("full", "QuotaExceededError");
      realSet.call(this, key, value);
    });
    const store = useProjectCacheStore.getState();
    store.put("old", entry("2026-01-01T00:00:00Z"));
    store.put("mid", entry("2026-02-01T00:00:00Z"));
    expect(() => store.put("new", entry("2026-03-01T00:00:00Z"))).not.toThrow();

    // In memory, everything stays for the session.
    expect(Object.keys(useProjectCacheStore.getState().entries).sort()).toEqual([
      "mid",
      "new",
      "old",
    ]);
    const persisted = JSON.parse(localStorage.getItem("artisan.project-cache") ?? "{}");
    expect(Object.keys(persisted.state.entries).sort()).toEqual(["mid", "new"]);
  });
});
