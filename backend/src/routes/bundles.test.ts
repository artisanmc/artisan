import { describe, expect, test, beforeEach } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { networks, serverKeys, projects, linkCodes, projectCommits, projectBranches } from "../db/schema";
import { bundlesRouter } from "./bundles";
import { generateServerKey } from "../lib/auth";
import { createNetwork } from "../lib/networkManager";
import { createProject, ensureProjectForServer } from "../lib/projectStorage";
import { createCommit, computeContentHash } from "../lib/commitStorage";
import { advanceBranchHead, getBranch } from "../lib/branchStorage";

const PACK_FILES = {
  "plugins/Artisan/projects/p_test/manifest.yaml": "schema: manifest/v1\nproject_id: p_test\n",
  "plugins/Artisan/projects/p_test/menus/shop.yaml": "id: shop\nsize: 27\n",
};

function buildApp() {
  const app = new Hono();
  app.route("/api/v1/bundles", bundlesRouter);
  return app;
}

async function seedServerKey(label: string): Promise<{ key: string; id: string; networkId: string }> {
  const { id, key, hash } = await generateServerKey();
  const network = await createNetwork(label + "-net");
  await db.insert(serverKeys).values({
    id,
    hash,
    label,
    networkId: network.id,
    createdAt: new Date(),
  });
  return { key, id, networkId: network.id };
}

beforeEach(async () => {
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networks);
});

describe("bundle upload/download", () => {
  test("POST /api/v1/bundles/p_test requires Authorization header", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(res.status).toBe(401);
  });

  test("POST preserves .artisan/* metadata absent from the upload (hash-excluded editor state)", async () => {
    const app = buildApp();
    const { key } = await seedServerKey("meta-preserve");

    const metaPath = "plugins/Artisan/projects/p_test/.artisan/editor.yaml";
    const withMeta = { ...PACK_FILES, [metaPath]: "schema: editor-state/v1\nlayout:\n  shop: { x: 1, y: 2 }\n" };
    const first = await app.request("/api/v1/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ files: withMeta }),
    });
    expect(first.status).toBe(200);

    // Plugin re-upload: never carries .artisan/* — the stored copy must survive.
    const second = await app.request("/api/v1/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(second.status).toBe(200);
    // The hash excludes .artisan/* on both uploads → identical.
    expect((await second.json() as { hash: string }).hash).toBe((await first.json() as { hash: string }).hash);

    const row = (await db.select().from(projects).where(eq(projects.id, "p_test")))[0]!;
    const stored = JSON.parse(row.filesJson!) as Record<string, string>;
    expect(stored[metaPath]).toContain("layout:");
  });

  test("POST writes WIP; GET serves main branch head (initial empty commit)", async () => {
    const app = buildApp();
    const { key } = await seedServerKey("bundle-test");

    // POST writes WIP content
    const uploadRes = await app.request("/api/v1/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { ok: boolean };
    expect(uploadBody.ok).toBe(true);

    // GET serves branch head commit — createProject auto-creates main with empty initial commit.
    const downloadRes = await app.request("/api/v1/bundles/p_test", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(downloadRes.status).toBe(200);
    const body = (await downloadRes.json()) as { files: Record<string, string>; hash: string };
    // Initial commit has empty files — POST WIP is NOT reflected until a commit is created.
    // Empty content hashes to "" (sentinel), consistent with the plugin's BundleHasher.
    expect(body.hash).toBe("");
    expect(body.files).toEqual({});
  });

  test("GET /api/v1/bundles/:projectId serves the bound branch's head commit content", async () => {
    const app = buildApp();
    const { key, id: skId, networkId } = await seedServerKey("c3-test");

    // Create project via DB helper (binding now implicit via serverKeyId column)
    const project = await createProject({ networkId, serverKeyId: skId, name: "c3-project", id: "p_c3" });

    // Add a second commit with concrete files and advance main head
    const files = { "menus/shop.yaml": "id: shop\nsize: 27\n" };
    const branch = await getBranch(project.id, "main");
    const commit2 = await createCommit({
      projectId: project.id,
      parentId: branch!.headCommitId,
      files,
      editor: null,
      authorUserId: null,
      message: "C3 test commit",
    });
    await advanceBranchHead(project.id, "main", commit2.id);

    const res = await app.request(`/api/v1/bundles/${project.id}`, {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Record<string, string>; hash: string };
    // Should serve commit2's content, not initial empty commit or WIP
    expect(body.hash).toBe(commit2.contentHash);
    expect(body.files).toEqual(files);
  });

  test("GET returns 404 Not bound when server key has no binding for project", async () => {
    const app = buildApp();
    const { key } = await seedServerKey("no-bind-test");

    const res = await app.request("/api/v1/bundles/p_unbound", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not bound");
  });

  test("second POST by same server key reuses existing project (no duplicate binding)", async () => {
    const app = buildApp();
    const { key, id: serverKeyId } = await seedServerKey("reuse-test");

    // First push — creates project + binding
    const res1 = await app.request("/api/v1/bundles/p_reuse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: { "plugins/Artisan/projects/p_reuse/manifest.yaml": "schema: manifest/v1\nproject_id: p_reuse\n" } }),
    });
    expect(res1.status).toBe(200);

    // Second push — project already exists, should update content not fail
    const updatedFiles = {
      "plugins/Artisan/projects/p_reuse/manifest.yaml": "schema: manifest/v1\nproject_id: p_reuse\n",
      "plugins/Artisan/projects/p_reuse/menus/shop.yaml": "id: shop\nsize: 54\n",
    };
    const res2 = await app.request("/api/v1/bundles/p_reuse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: updatedFiles }),
    });
    expect(res2.status).toBe(200);

    // Only one project row should exist (no duplicate created on second POST)
    const projectRows = await db.select().from(projects).where(eq(projects.id, "p_reuse"));
    expect(projectRows.length).toBe(1);

    // GET serves branch head commit (initial empty commit) — NOT the WIP files from POST.
    const getRes = await app.request("/api/v1/bundles/p_reuse", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { files: Record<string, string>; hash: string };
    // Branch head is still the initial empty commit
    expect(getBody.files).toEqual({});
  });
});

// Mirror of the WS local_push guard: two unrelated servers can both hold a
// project with the same on-disk id (the Boutique add-on always bootstraps
// `boutique_shop`). A POST authenticated as B must never reach A's row.
describe("project ownership isolation", () => {
  const DISK_ID = "boutique_shop";

  test("POST from server B does not overwrite server A's project of the same id", async () => {
    const app = buildApp();
    const a = await seedServerKey("owner-a");
    const b = await seedServerKey("owner-b");

    const aFiles = { [`plugins/Artisan/projects/${DISK_ID}/menus/a.yaml`]: "id: a" };
    const bFiles = { [`plugins/Artisan/projects/${DISK_ID}/menus/b.yaml`]: "id: b" };

    const first = await app.request(`/api/v1/bundles/${DISK_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.key}` },
      body: JSON.stringify({ files: aFiles }),
    });
    expect(first.status).toBe(200);

    const second = await app.request(`/api/v1/bundles/${DISK_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.key}` },
      body: JSON.stringify({ files: bFiles }),
    });
    expect(second.status).toBe(200);

    const rowsA = await db.select().from(projects).where(eq(projects.serverKeyId, a.id));
    const rowsB = await db.select().from(projects).where(eq(projects.serverKeyId, b.id));
    expect(rowsA.length).toBe(1);
    expect(rowsB.length).toBe(1);
    expect(JSON.parse(rowsA[0].filesJson)).toEqual(aFiles);
    expect(JSON.parse(rowsB[0].filesJson)).toEqual(bFiles);
    expect(rowsA[0].externalId).toBe(DISK_ID);
    expect(rowsB[0].externalId).toBe(DISK_ID);
    expect(rowsA[0].id).not.toBe(rowsB[0].id);
  });

  test("GET by disk id serves the caller's own project even when the internal id differs", async () => {
    const app = buildApp();
    const a = await seedServerKey("dl-a");
    const b = await seedServerKey("dl-b");

    // A claims the disk id first, so B's row gets a generated internal id.
    await createProject({ networkId: a.networkId, serverKeyId: a.id, name: DISK_ID, id: DISK_ID });
    const bProject = await ensureProjectForServer({
      networkId: b.networkId, serverKeyId: b.id, diskId: DISK_ID,
    });
    expect(bProject.id).not.toBe(DISK_ID);
    expect(bProject.externalId).toBe(DISK_ID);

    const files = { "menus/b.yaml": "id: b" };
    const branch = await getBranch(bProject.id, "main");
    const commit = await createCommit({
      projectId: bProject.id, parentId: branch!.headCommitId, files,
      authorUserId: null, message: "b commit",
    });
    await advanceBranchHead(bProject.id, "main", commit.id);

    // The plugin asks for its disk id and must get ITS files, not A's.
    const res = await app.request(`/api/v1/bundles/${DISK_ID}`, {
      headers: { Authorization: `Bearer ${b.key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files).toEqual(files);
  });
});

// A commit's contentHash is what the plugin compares against its own disk hash.
// It must be computed over disk-id-prefixed paths — hashing with the internal
// row id leaves the prefix unstripped, and the plugin rejects every bundle as
// divergent (caught against the real plugin, 2026-08-12).
describe("commit content hash uses the disk id", () => {
  test("namespaced project hashes identically to the plugin's view of the same tree", async () => {
    const a = await seedServerKey("hash-a");
    const b = await seedServerKey("hash-b");
    const DISK_ID = "boutique_shop";

    await createProject({ networkId: a.networkId, serverKeyId: a.id, name: DISK_ID, id: DISK_ID });
    const bProject = await ensureProjectForServer({
      networkId: b.networkId, serverKeyId: b.id, diskId: DISK_ID,
    });
    expect(bProject.id).not.toBe(DISK_ID);

    const files = { [`plugins/Artisan/projects/${DISK_ID}/menus/shop.yaml`]: "id: shop" };
    const branch = await getBranch(bProject.id, "main");
    const commit = await createCommit({
      projectId: bProject.id, parentId: branch!.headCommitId, files,
      authorUserId: null, message: "push",
    });

    expect(commit.contentHash).toBe(computeContentHash(files, DISK_ID));
    expect(commit.contentHash).not.toBe(computeContentHash(files, bProject.id));
  });
});
