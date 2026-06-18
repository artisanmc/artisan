import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listBranches, createBranch, listCommits, createCommit, promoteBranch,
} from "./branches";

describe("branches API client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("listBranches GET", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      branches: [{ projectId: "p", name: "main", headCommitId: "cmt_1" }],
    }), { status: 200 }));
    const list = await listBranches("n1", "p1");
    expect(list[0].name).toBe("main");
  });

  it("createBranch POST", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      branch: { projectId: "p", name: "dev", headCommitId: "cmt_1" },
    }), { status: 201 }));
    const b = await createBranch("n1", "p1", "dev", "main");
    expect(b.name).toBe("dev");
  });

  it("listCommits GET", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      commits: [{ id: "cmt_1", message: "x" }],
    }), { status: 200 }));
    const list = await listCommits("n1", "p1", "main", 20);
    expect(list).toHaveLength(1);
  });

  it("createCommit POST", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      commit: { id: "cmt_2", message: "hello" },
    }), { status: 201 }));
    const c = await createCommit("n1", "p1", "main", "hello");
    expect(c.id).toBe("cmt_2");
  });

  it("promoteBranch POST", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, advanced: true }), { status: 200 }));
    const res = await promoteBranch("n1", "p1", "dev", "main");
    expect(res.advanced).toBe(true);
  });

  it("promoteBranch throws on 409 (not fast-forward)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "not_fast_forward" }), { status: 409 }));
    await expect(promoteBranch("n1", "p1", "dev", "main")).rejects.toThrow(/not_fast_forward/);
  });
});
