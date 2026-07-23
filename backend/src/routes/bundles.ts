import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverKeys, projects, projectBranches, projectCommits } from "../db/schema";
import { validateServerKeyHeader } from "../lib/auth";
import { computeBundleHash } from "../lib/hashUtils";
import { getProject, createProject, upsertProjectContent } from "../lib/projectStorage";

const router = new Hono();

router.post("/:projectId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);

  const projectId = c.req.param("projectId");

  const body = await c.req.json<{ files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, projectId);

  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!sk) return c.json({ error: "Server key missing" }, 500);

  let project = await getProject(projectId);
  if (!project) {
    project = await createProject({ networkId: sk.networkId, serverKeyId: sk.id, name: projectId, id: projectId });
  }
  // The plugin never uploads `.artisan/*` metadata (hash-excluded editor
  // state) — preserve the backend's copies across a plugin upload.
  if (project.filesJson) {
    const prev = JSON.parse(project.filesJson) as Record<string, string>;
    const metaPrefix = `plugins/Artisan/projects/${projectId}/.artisan`;
    for (const [k, v] of Object.entries(prev)) {
      if (k.startsWith(metaPrefix) && !(k in body.files)) body.files[k] = v;
    }
  }
  await upsertProjectContent(projectId, { hash, filesJson: JSON.stringify(body.files) });
  return c.json({ ok: true, hash });
});

router.get("/:projectId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);

  const projectId = c.req.param("projectId");

  // Verify the project belongs to this server_key (1:1 ownership via projects.serverKeyId)
  const projectRow = (await db.select().from(projects).where(and(
    eq(projects.id, projectId),
    eq(projects.serverKeyId, serverKeyId),
  )))[0];
  if (!projectRow) return c.json({ error: "Not bound" }, 404);

  const branch = (await db.select().from(projectBranches).where(and(
    eq(projectBranches.projectId, projectId), eq(projectBranches.name, "main"),
  )))[0];
  if (!branch) return c.json({ error: "Branch not found" }, 404);

  const commit = (await db.select().from(projectCommits).where(eq(projectCommits.id, branch.headCommitId)))[0];
  if (!commit) return c.json({ error: "Commit not found" }, 500);

  return c.json({
    hash: commit.contentHash,
    files: JSON.parse(commit.filesJson) as Record<string, string>,
  });
});

export { router as bundlesRouter };
