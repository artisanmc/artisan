import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listBranches, createBranch, listCommits, createCommit, promoteBranch,
  mergeBranches, resolveMerge,
} from "./branches";

describe("branches API client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("listBranches GET", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      branches: [{ packId: "p", name: "main", headCommitId: "cmt_1" }],
    }), { status: 200 }));
    const list = await listBranches("n1", "p1");
    expect(list[0].name).toBe("main");
  });

  it("createBranch POST", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      branch: { packId: "p", name: "dev", headCommitId: "cmt_1" },
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

describe("mergeBranches + resolveMerge", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("mergeBranches returns the plan", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      kind: "auto",
      conflicts: [],
      mergedEditorJson: { menus: [] },
      lcaCommitId: "cmt_lca",
      srcCommitId: "cmt_src",
      dstCommitId: "cmt_dst",
    }), { status: 200 }));
    const plan = await mergeBranches("n1", "p1", "dev", "main");
    expect(plan.kind).toBe("auto");
  });

  it("mergeBranches throws on 4xx/5xx", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "same_branch" }), { status: 400 }));
    await expect(mergeBranches("n1", "p1", "main", "main")).rejects.toThrow(/same_branch/);
  });

  it("resolveMerge returns the new commit", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      commit: { id: "cmt_merge", message: "x" }, head_commit_id: "cmt_merge",
    }), { status: 201 }));
    const res = await resolveMerge("n1", "p1", "dev", "main", {
      resolutions: {},
      lcaCommitId: "cmt_lca", srcCommitId: "cmt_src", dstCommitId: "cmt_dst",
      mergedFilesJson: {}, mergedEditorJson: {},
    });
    expect(res.commit.id).toBe("cmt_merge");
  });

  it("resolveMerge throws stale_merge on 409", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "stale_merge" }), { status: 409 }));
    await expect(resolveMerge("n1", "p1", "dev", "main", {
      resolutions: {}, lcaCommitId: "", srcCommitId: "", dstCommitId: "",
      mergedFilesJson: {}, mergedEditorJson: {},
    })).rejects.toThrow(/stale_merge/);
  });
});
