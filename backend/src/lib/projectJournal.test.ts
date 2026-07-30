import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { networks, projectBranches, projectCommits, projects, serverKeys } from "../db/schema";
import { generateServerKey } from "./auth";
import { createNetwork } from "./networkManager";
import { createProject, getProject, upsertProjectContent } from "./projectStorage";
import { getBranch } from "./branchStorage";
import { applyConfigPatch, journalProjectFiles } from "./projectJournal";

const PROJECT_ID = "p_journal";
const base = `plugins/Artisan/projects/${PROJECT_ID}`;

const MANIFEST =
  "schema: manifest/v1\nproject_id: p_journal\ndefault_lang: fr\nlanguages: [fr]\nfiles:\n  menus: []\n  commands: []\n";

async function seed() {
  const net = await createNetwork("N");
  const { id: keyId, hash } = await generateServerKey();
  await db.insert(serverKeys).values({
    id: keyId,
    hash,
    label: null,
    networkId: net.id,
    createdAt: new Date(),
  });
  const project = await createProject({
    networkId: net.id,
    serverKeyId: keyId,
    name: "Journal",
    id: PROJECT_ID,
  });
  await upsertProjectContent(project.id, {
    hash: "h0",
    filesJson: JSON.stringify({
      [`${base}/manifest.yaml`]: MANIFEST,
      [`${base}/data/categories/armes.yaml`]: "id: armes\nname: Armes\n",
    }),
  });
  return { keyId };
}

async function storedFiles(): Promise<Record<string, string>> {
  const p = await getProject(PROJECT_ID);
  return JSON.parse(p!.filesJson) as Record<string, string>;
}

describe("applyConfigPatch", () => {
  const prev = {
    [`${base}/manifest.yaml`]: MANIFEST,
    [`${base}/data/categories/armes.yaml`]: "id: armes\n",
  };

  test("writes land under the project's canonical prefix", () => {
    const next = applyConfigPatch(prev, PROJECT_ID, [
      { path: "data/categories/potions.yaml", content: "id: potions\n" },
    ], []);
    expect(next[`${base}/data/categories/potions.yaml`]).toBe("id: potions\n");
    // Untouched files survive.
    expect(next[`${base}/manifest.yaml`]).toBe(MANIFEST);
  });

  test("a write to an existing path replaces it", () => {
    const next = applyConfigPatch(prev, PROJECT_ID, [
      { path: "data/categories/armes.yaml", content: "id: armes\nname: Armes\n" },
    ], []);
    expect(next[`${base}/data/categories/armes.yaml`]).toBe("id: armes\nname: Armes\n");
  });

  test("deletes remove the file", () => {
    const next = applyConfigPatch(prev, PROJECT_ID, [], ["data/categories/armes.yaml"]);
    expect(next[`${base}/data/categories/armes.yaml`]).toBeUndefined();
    expect(Object.keys(next)).toEqual([`${base}/manifest.yaml`]);
  });

  test("leaves the previous map untouched", () => {
    applyConfigPatch(prev, PROJECT_ID, [{ path: "x.yaml", content: "a" }], ["manifest.yaml"]);
    expect(prev[`${base}/manifest.yaml`]).toBe(MANIFEST);
  });
});

describe("journalProjectFiles", () => {
  beforeEach(async () => {
    await db.delete(projectBranches);
    await db.delete(projectCommits);
    await db.delete(projects);
    await db.delete(serverKeys);
    await db.delete(networks);
  });

  test("stores the tree, commits it and advances main", async () => {
    await seed();
    const before = await getBranch(PROJECT_ID, "main");

    const next = applyConfigPatch(await storedFiles(), PROJECT_ID, [
      { path: "data/categories/potions.yaml", content: "id: potions\n" },
    ], []);
    const res = await journalProjectFiles(PROJECT_ID, next, { message: "config: potions" });

    expect(res.ok).toBe(true);
    // The stored tree carries the new file…
    expect((await storedFiles())[`${base}/data/categories/potions.yaml`]).toBe("id: potions\n");
    // …and main moved to a fresh commit.
    const after = await getBranch(PROJECT_ID, "main");
    expect(after!.headCommitId).not.toBe(before!.headCommitId);
    const commit = (
      await db.select().from(projectCommits).where(eq(projectCommits.id, after!.headCommitId))
    )[0];
    expect(commit!.message).toBe("config: potions");
    expect(res.ok && res.contentHash).toBe(commit!.contentHash);
  });

  test("an unknown project is not journaled rather than silently created", async () => {
    const res = await journalProjectFiles("p_absent", {}, { message: "x" });
    expect(res).toEqual({ ok: false, reason: "not_a_project" });
  });

  test("re-writing an identical tree adds no history entry", async () => {
    // `createCommit` dedupes on (projectId, contentHash): saving a Config screen
    // twice without changing anything must not litter the history.
    await seed();
    const files = await storedFiles();
    await journalProjectFiles(PROJECT_ID, files, { message: "first" });
    const after1 = await db.select().from(projectCommits);
    await journalProjectFiles(PROJECT_ID, files, { message: "second" });
    const after2 = await db.select().from(projectCommits);
    expect(after2.length).toBe(after1.length);
    expect(after2.some((c) => c.message === "second")).toBe(false);
  });
});
