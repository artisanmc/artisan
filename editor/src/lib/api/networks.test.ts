import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, getNetwork, listNetworks } from "./networks";

describe("networks API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listNetworks GET /api/v1/networks returns list", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            networks: [{ id: "n1", name: "Network 1", tier: "free" }],
          }),
          { status: 200 },
        ),
    );
    const result = await listNetworks();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks$/),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("getNetwork GET /api/v1/networks/:id returns detail", async () => {
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
    const result = await getNetwork("n1");
    expect(result.network.id).toBe("n1");
    expect(result.projects).toHaveLength(1);
    expect(result.serverKeys).toHaveLength(1);
  });

  it("createProject POST /api/v1/networks/:id/projects returns project", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            project: { id: "p_new", name: "new-project", hash: "h_new" },
          }),
          { status: 201 },
        ),
    );
    const result = await createProject("n1", "sk1", "new-project");
    expect(result.name).toBe("new-project");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1\/projects$/),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
