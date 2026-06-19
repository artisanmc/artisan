import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadUserProject, saveUserProject } from "./userProjects";

describe("userProjects API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loadUserProject GET /api/v1/user/projects/:projectId returns content", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          project: { id: "p1", hash: "h1" },
          files: { "a.yaml": "x" },
          editor: { id: "p1", menus: [] },
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
      editor: { id: "p1", menus: [] },
    });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/user/projects/p1");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string).hash).toBe("h2");
  });
});
