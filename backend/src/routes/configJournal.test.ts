// Config-screen writes are journaled (ADR module-config-screens §3, revised
// 2026-07-30): a managed root is a versioned root.
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships,
  networks,
  projectBranches,
  projectCommits,
  projects,
  serverKeys,
  userSessions,
  users,
} from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { addMembership } from "../lib/membershipManager";
import { createProject, getProject, upsertProjectContent } from "../lib/projectStorage";
import { getBranch } from "../lib/branchStorage";
import { userAuth } from "../middleware/userAuth";
import { connSenders, connToServerId, handlePluginMessage, registerConn } from "../ws/hub";
import { userNetworksRouter } from "./userNetworks";

const PROJECT_ID = "p_cfg";
const base = `plugins/Artisan/projects/${PROJECT_ID}`;
const MANIFEST =
  "schema: manifest/v1\nproject_id: p_cfg\ndefault_lang: fr\nlanguages: [fr]\nfiles:\n  menus: []\n  commands: []\n";

async function clearAll() {
  await db.delete(projectBranches);
  await db.delete(projectCommits);
  await db.delete(projects);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/networks/*", userAuth());
  app.route("/api/v1/networks", userNetworksRouter);
  return app;
}

/** A member user, a network, a bound server key, and (optionally) its project. */
async function seed({ withProject }: { withProject: boolean }) {
  await db.insert(users).values({
    id: "u1", email: "u1@a.b", name: "u1", passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const session = await createSession("u1");
  const networkId = crypto.randomUUID();
  await db.insert(networks).values({
    id: networkId, name: "N", createdAt: new Date(), updatedAt: new Date(),
  });
  await addMembership("u1", networkId, "owner");
  const keyId = crypto.randomUUID();
  await db.insert(serverKeys).values({
    id: keyId, hash: "h-cfg", networkId, createdAt: new Date(),
  });
  if (withProject) {
    await createProject({ networkId, serverKeyId: keyId, name: "Cfg", id: PROJECT_ID });
    await upsertProjectContent(PROJECT_ID, {
      hash: "h0",
      filesJson: JSON.stringify({
        [`${base}/manifest.yaml`]: MANIFEST,
        [`${base}/data/categories/armes.yaml`]: "id: armes\nname: Armes\n",
      }),
    });
  }
  return { sessionId: session.id, networkId, keyId };
}

/** Fake plugin that acks every config_write. */
function fakePlugin(connId: string, keyId: string) {
  registerConn(connId, (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type !== "config_write") return;
    queueMicrotask(() => {
      handlePluginMessage(
        connId,
        JSON.stringify({ type: "config_write_result", request_id: msg.request_id, ok: true }),
      );
    });
  });
  connToServerId.set(connId, keyId);
  return () => {
    connToServerId.delete(connId);
    connSenders.delete(connId);
  };
}

function write(app: Hono, networkId: string, keyId: string, sessionId: string, body: unknown) {
  return app.request(`/api/v1/networks/${networkId}/servers/${keyId}/config/write`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("config screen writes are journaled", () => {
  beforeEach(clearAll);

  test("a write lands in the stored tree and in the history", async () => {
    const { sessionId, networkId, keyId } = await seed({ withProject: true });
    const stop = fakePlugin("conn-cfg", keyId);
    const headBefore = (await getBranch(PROJECT_ID, "main"))!.headCommitId;
    try {
      const res = await write(makeApp(), networkId, keyId, sessionId, {
        project_id: PROJECT_ID,
        files: [{ path: "data/categories/potions.yaml", content: "id: potions\n" }],
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, journaled: true });
    } finally {
      stop();
    }

    const stored = JSON.parse((await getProject(PROJECT_ID))!.filesJson) as Record<string, string>;
    expect(stored[`${base}/data/categories/potions.yaml`]).toBe("id: potions\n");

    const head = (await getBranch(PROJECT_ID, "main"))!.headCommitId;
    expect(head).not.toBe(headBefore);
    const commits = await db.select().from(projectCommits);
    expect(commits.some((c) => c.message === "config: data/categories/potions.yaml")).toBe(true);
    expect(commits.some((c) => c.authorUserId === "u1")).toBe(true);
  });

  test("a delete is journaled too", async () => {
    const { sessionId, networkId, keyId } = await seed({ withProject: true });
    const stop = fakePlugin("conn-cfg-del", keyId);
    try {
      const res = await write(makeApp(), networkId, keyId, sessionId, {
        project_id: PROJECT_ID,
        files: [],
        deletes: ["data/categories/armes.yaml"],
      });
      expect(res.status).toBe(200);
    } finally {
      stop();
    }
    const stored = JSON.parse((await getProject(PROJECT_ID))!.filesJson) as Record<string, string>;
    expect(stored[`${base}/data/categories/armes.yaml`]).toBeUndefined();
  });

  test("a root that is not an Artisan project stays live-only — nothing is invented", async () => {
    const { sessionId, networkId, keyId } = await seed({ withProject: false });
    const stop = fakePlugin("conn-cfg-foreign", keyId);
    try {
      const res = await write(makeApp(), networkId, keyId, sessionId, {
        project_id: "plugins_SomeOtherPlugin",
        files: [{ path: "config.yml", content: "a: 1\n" }],
      });
      // The live write still happened; it simply left no history.
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, journaled: false });
    } finally {
      stop();
    }
    expect(await getProject("plugins_SomeOtherPlugin")).toBeNull();
    expect(await db.select().from(projectCommits)).toEqual([]);
  });

  test("nothing is journaled when the plugin refuses the write", async () => {
    const { sessionId, networkId, keyId } = await seed({ withProject: true });
    const headBefore = (await getBranch(PROJECT_ID, "main"))!.headCommitId;
    registerConn("conn-cfg-ko", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type !== "config_write") return;
      queueMicrotask(() => {
        handlePluginMessage(
          "conn-cfg-ko",
          JSON.stringify({
            type: "config_write_result",
            request_id: msg.request_id,
            ok: false,
            error: "write_error",
          }),
        );
      });
    });
    connToServerId.set("conn-cfg-ko", keyId);
    try {
      const res = await write(makeApp(), networkId, keyId, sessionId, {
        project_id: PROJECT_ID,
        files: [{ path: "data/categories/potions.yaml", content: "id: potions\n" }],
      });
      expect(res.status).toBe(502);
    } finally {
      connToServerId.delete("conn-cfg-ko");
      connSenders.delete("conn-cfg-ko");
    }
    // History must never claim a write that never reached the disk.
    expect((await getBranch(PROJECT_ID, "main"))!.headCommitId).toBe(headBefore);
    const stored = JSON.parse((await getProject(PROJECT_ID))!.filesJson) as Record<string, string>;
    expect(stored[`${base}/data/categories/potions.yaml`]).toBeUndefined();
  });
});
