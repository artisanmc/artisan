import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, getNetwork } from "./networks";

describe("networks API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getNetwork GET /api/v1/network returns detail", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            network: { id: "n1", name: "Network 1", tier: "free" },
            projects: [{ id: "p1", name: "pack1", hash: "h1" }],
            serverKeys: [{ id: "sk_1", label: null }],
          }),
          { status: 200 },
        ),
    );
    const result = await getNetwork();
    expect(result.network.id).toBe("n1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/network$/),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(result.projects).toHaveLength(1);
    expect(result.serverKeys).toHaveLength(1);
  });

  it("createProject POST /api/v1/network/projects returns project", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            project: { id: "p_new", name: "new-project", hash: "h_new" },
          }),
          { status: 201 },
        ),
    );
    const result = await createProject("sk1", "new-project");
    expect(result.name).toBe("new-project");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/network\/projects$/),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
