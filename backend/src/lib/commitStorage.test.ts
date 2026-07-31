import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { projectCommits, projectBranches, projects, networks, serverKeys, users } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  createCommit, getCommit, listCommitsByProject, computeContentHash,
} from "./commitStorage";
import { createNetwork } from "./networkManager";
import { createProject } from "./projectStorage";
import { generateServerKey } from "./auth";

async function seedSetup() {
  await db.delete(projectBranches);
  await db.delete(projectCommits);
  await db.delete(projects);
  await db.delete(serverKeys);
  await db.delete(networks);
  await db.delete(users);
  const net = await createNetwork("N");
  const { id: skId, hash: skHash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: net.id, createdAt: new Date() });
  const project = await createProject({ networkId: net.id, serverKeyId: skId, name: "p" });
  return { networkId: net.id, projectId: project.id };
}

describe("commitStorage", () => {
  it("computeContentHash is deterministic across calls", () => {
    const files = { "a.yaml": "x", "b.yaml": "y" };
    const h1 = computeContentHash(files, "p1");
    const h2 = computeContentHash({ "b.yaml": "y", "a.yaml": "x" }, "p1");  // different key order
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeContentHash returns '' for empty files (empty-content sentinel)", () => {
    // Invariant: "" = no content, consistent with BundleHasher/computeBundleHash.
    // The plugin's auto-push relies on an empty backend project hashing to "".
    expect(computeContentHash({}, "p1")).toBe("");
  });

  it("computeContentHash matches the canonical project hash (single house hash — CLAUDE.md invariant)", async () => {
    // The commit contentHash IS the same canonical hash the plugin (BundleHasher)
    // and computeBundleHash produce: relPath-keyed, byte-order sorted, `.artisan*`
    // first-segment excluded. Divergence here made hello_ack.project_hashes never
    // match the plugin's disk hash — detectSyncAction could never see LOCAL_ONLY.
    const { readFileSync, existsSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    let dir = process.cwd();
    while (!existsSync(join(dir, "testdata", "project-hash-conformance.json"))) {
      const parent = dirname(dir);
      if (parent === dir) throw new Error("conformance fixture not found");
      dir = parent;
    }
    const vector = JSON.parse(readFileSync(join(dir, "testdata", "project-hash-conformance.json"), "utf8"));
    // Keys as stored in a commit's filesJson (full plugin-disk paths).
    const prefixed: Record<string, string> = {};
    for (const [k, v] of Object.entries(vector.files as Record<string, string>)) {
      prefixed[`plugins/Artisan/projects/${vector.projectId}/${k}`] = v;
    }
    expect(computeContentHash(prefixed, vector.projectId)).toBe(vector.expectedHash);
    // Already-relative keys hash identically (tolerated input shape).
    expect(computeContentHash(vector.files, vector.projectId)).toBe(vector.expectedHash);
  });

  it("computeContentHash excludes .artisan* metadata (hash-exclusion invariant)", () => {
    const base = { "manifest.yaml": "id: p\n" };
    const withMeta = { ...base, ".artisan-sync.yaml": "x\n", ".artisan/editor.yaml": "y\n" };
    expect(computeContentHash(withMeta, "p1")).toBe(computeContentHash(base, "p1"));
  });

  it("createCommit inserts with cmt_ id and computed contentHash", async () => {
    const { projectId } = await seedSetup();
    const cmt = await createCommit({
      projectId,
      parentId: null,
      files: { "a.yaml": "x" },
      editor: { id: projectId, menus: [] },
      authorUserId: null,
      message: "initial",
    });
    expect(cmt.id).toMatch(/^cmt_[0-9a-f]{12}$/);
    expect(cmt.projectId).toBe(projectId);
    expect(cmt.parentId).toBeNull();
    expect(cmt.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cmt.message).toBe("initial");
  });

  it("createCommit returns existing commit when same (projectId, contentHash) — dedup", async () => {
    const { projectId } = await seedSetup();
    const files = { "a.yaml": "x" };
    const editor = { id: projectId, menus: [] };
    const c1 = await createCommit({ projectId, parentId: null, files, editor, authorUserId: null, message: "first" });
    const c2 = await createCommit({ projectId, parentId: c1.id, files, editor, authorUserId: null, message: "second" });
    expect(c2.id).toBe(c1.id);  // same id = same commit (dedup)
    // Note: createProject now auto-creates an initial empty commit, so there are 2 total:
    // the initial commit (empty files) and the commit created by this test (with files).
    const rows = await db.select().from(projectCommits).where(eq(projectCommits.projectId, projectId));
    expect(rows).toHaveLength(2);
  });

  it("getCommit returns the row or null", async () => {
    const { projectId } = await seedSetup();
    const c = await createCommit({ projectId, parentId: null, files: { "a": "x" }, editor: null, authorUserId: null, message: "" });
    expect((await getCommit(c.id))?.id).toBe(c.id);
    expect(await getCommit("cmt_nope")).toBeNull();
  });

  it("listCommitsByProject returns commits in reverse chronological order", async () => {
    const { projectId } = await seedSetup();
    const a = await createCommit({ projectId, parentId: null, files: { "f": "1" }, editor: null, authorUserId: null, message: "a" });
    await new Promise((r) => setTimeout(r, 10));
    const b = await createCommit({ projectId, parentId: a.id, files: { "f": "2" }, editor: null, authorUserId: null, message: "b" });
    const list = await listCommitsByProject(projectId, 10);
    // Note: createProject now auto-creates an initial empty commit, so expect it in the list.
    // Order should be: b (newest), a, then the auto-created initial commit (oldest).
    const ids = list.map((c) => c.id);
    expect(ids[0]).toBe(b.id);
    expect(ids[1]).toBe(a.id);
    expect(ids).toHaveLength(3);  // b, a, and the auto-created initial commit
  });
});
