import { describe, expect, test, beforeEach } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { networks, serverKeys, projects, linkCodes, projectCommits, projectBranches } from "../db/schema";
import { bundlesRouter } from "./bundles";
import { generateServerKey } from "../lib/auth";
import { createNetwork } from "../lib/networkManager";
import { createProject } from "../lib/projectStorage";
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

    // Create pack via DB helper (binding now implicit via serverKeyId column)
    const pack = await createProject({ networkId, serverKeyId: skId, name: "c3-pack", id: "p_c3" });

    // Add a second commit with concrete files and advance main head
    const files = { "menus/shop.yaml": "id: shop\nsize: 27\n" };
    const branch = await getBranch(pack.id, "main");
    const commit2 = await createCommit({
      projectId: pack.id,
      parentId: branch!.headCommitId,
      files,
      editor: null,
      authorUserId: null,
      message: "C3 test commit",
    });
    await advanceBranchHead(pack.id, "main", commit2.id);

    const res = await app.request(`/api/v1/bundles/${pack.id}`, {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Record<string, string>; hash: string };
    // Should serve commit2's content, not initial empty commit or WIP
    expect(body.hash).toBe(commit2.contentHash);
    expect(body.files).toEqual(files);
  });

  test("GET returns 404 Not bound when server key has no binding for pack", async () => {
    const app = buildApp();
    const { key } = await seedServerKey("no-bind-test");

    const res = await app.request("/api/v1/bundles/p_unbound", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not bound");
  });

  test("second POST by same server key reuses existing pack (no duplicate binding)", async () => {
    const app = buildApp();
    const { key, id: serverKeyId } = await seedServerKey("reuse-test");

    // First push — creates pack + binding
    const res1 = await app.request("/api/v1/bundles/p_reuse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: { "plugins/Artisan/projects/p_reuse/manifest.yaml": "schema: manifest/v1\nproject_id: p_reuse\n" } }),
    });
    expect(res1.status).toBe(200);

    // Second push — pack already exists, should update content not fail
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

    // Only one pack row should exist (no duplicate created on second POST)
    const packRows = await db.select().from(projects).where(eq(projects.id, "p_reuse"));
    expect(packRows.length).toBe(1);

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
