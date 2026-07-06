import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadProjects, saveProject } from "./projectApi";
import { useProjectVersionStore, VersionConflictError } from "@/state/projectVersionStore";
import type { Project } from "@/domain/types";

const fakePack = { id: "p1", name: "P", menus: [] } as unknown as Project;

describe("projectApi — optimistic concurrency (session mode)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProjectVersionStore.setState({ versions: {}, conflicts: {} });
  });

  it("loadProjects records each project's version in the version store", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          projects: [
            { project_id: "p1", name: "P", hash: "h", version: 2, files: {}, editor: null },
            { project_id: "p2", name: "Q", hash: "h", version: 5, files: {}, editor: null },
          ],
        }),
        { status: 200 }
      )
    );
    await loadProjects("tok");
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(2);
    expect(useProjectVersionStore.getState().versions["p2"]).toBe(5);
  });

  it("saveProject sends `project` + base_version and records the new version", async () => {
    useProjectVersionStore.getState().setVersion("p1", 2);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "h", version: 3 }), { status: 201 })
    );
    await saveProject("tok", fakePack, {});
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    // wire key is `project` (backend rejects `pack` since the pack→project wire flip)
    expect(body.project).toBeDefined();
    expect(body.pack).toBeUndefined();
    expect(body.base_version).toBe(2);
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(3);
  });

  it("saveProject on 409 marks the conflict and throws VersionConflictError", async () => {
    useProjectVersionStore.getState().setVersion("p1", 2);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "version_conflict", current_version: 6 }), { status: 409 })
    );
    await expect(saveProject("tok", fakePack, {})).rejects.toBeInstanceOf(VersionConflictError);
    expect(useProjectVersionStore.getState().conflicts["p1"]).toBe(true);
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(2);
  });
});
