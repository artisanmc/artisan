import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadUserProject, saveUserProject } from "./userProjects";
import { useProjectVersionStore, VersionConflictError } from "@/state/projectVersionStore";

describe("userProjects API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProjectVersionStore.setState({ versions: {}, conflicts: {} });
  });

  it("loadUserProject GET /api/v1/user/projects/:projectId returns content", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          project: { id: "p1", hash: "h1" },
          files: { "a.yaml": "x" },
        }),
        { status: 200 }
      )
    );
    const res = await loadUserProject("p1");
    expect(res.project.id).toBe("p1");
    expect(res.files["a.yaml"]).toBe("x");
  });

  it("saveUserProject PUT /api/v1/user/projects/:projectId sends body", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await saveUserProject("p1", {
      hash: "h2",
      files: { a: "y" },
    });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/user/projects/p1");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string).hash).toBe("h2");
  });

  it("loadUserProject records the project version in the version store", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          project: { id: "p1", hash: "h1", version: 4 },
          files: {},
        }),
        { status: 200 }
      )
    );
    await loadUserProject("p1");
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(4);
  });

  it("loadUserProject clears a stale conflict flag for the reloaded project", async () => {
    useProjectVersionStore.getState().markConflict("p1");
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ project: { id: "p1", hash: "h1", version: 6 }, files: {} }),
        { status: 200 }
      )
    );
    await loadUserProject("p1");
    expect(useProjectVersionStore.getState().conflicts["p1"]).toBeUndefined();
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(6);
  });

  it("saveUserProject sends baseVersion from the store and records the new version", async () => {
    useProjectVersionStore.getState().setVersion("p1", 4);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, version: 5 }), { status: 200 })
    );
    await saveUserProject("p1", { hash: "", files: {} });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body as string).baseVersion).toBe(4);
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(5);
  });

  it("saveUserProject on 409 marks the conflict and throws VersionConflictError", async () => {
    useProjectVersionStore.getState().setVersion("p1", 4);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "version_conflict", currentVersion: 7 }), { status: 409 })
    );
    await expect(
      saveUserProject("p1", { hash: "", files: {} })
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect(useProjectVersionStore.getState().conflicts["p1"]).toBe(true);
    // version is NOT advanced — the local state is still based on 4
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(4);
  });
});
