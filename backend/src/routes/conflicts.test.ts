import { describe, expect, test } from "bun:test";
import { app } from "../app";

async function createServerWithSession(label: string) {
  const keyRes = await app.request("/api/server-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  const { key, id: serverKeyId } = (await keyRes.json()) as { key: string; id: string };
  const { db } = await import("../db/index");
  const { editorSessions } = await import("../db/schema");
  const accessToken = `acc_${crypto.randomUUID()}`;
  await db.insert(editorSessions).values({
    token: `etok_${crypto.randomUUID()}`,
    serverKeyId,
    createdBy: "test",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86400_000),
    exchangedAt: new Date(),
    accessToken,
    accessExpiresAt: new Date(Date.now() + 86400_000),
  });
  return { key, serverKeyId, accessToken };
}

async function seedConflict(serverKeyId: string, packId: string, diskFiles: Record<string, string>, backendFiles: Record<string, string>) {
  const { db } = await import("../db/index");
  const { packBundles, packConflicts } = await import("../db/schema");
  await db.insert(packBundles).values({
    id: crypto.randomUUID(), serverId: serverKeyId, packId,
    hash: "backendH", filesJson: JSON.stringify(backendFiles),
    editorJson: JSON.stringify({ id: packId, name: packId }),
    createdAt: new Date(),
  });
  const conflictId = crypto.randomUUID();
  await db.insert(packConflicts).values({
    id: conflictId, serverId: serverKeyId, packId,
    diskFilesJson: JSON.stringify(diskFiles), diskHash: "diskH",
    lastSyncedHash: "syncedH", backendHashAtDetection: "backendH",
    detectedAt: new Date(),
  });
  return conflictId;
}

describe("/api/editor-session/:token/conflicts", () => {
  test("GET conflicts — empty when no conflict", async () => {
    const { accessToken } = await createServerWithSession("conf-empty");
    const res = await app.request(`/api/editor-session/${accessToken}/conflicts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conflicts: unknown[] };
    expect(body.conflicts).toEqual([]);
  });

  test("GET conflicts — lists open conflicts with diff summary", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-list");
    await seedConflict(serverKeyId, "p_a", { "menus/m.yaml": "new" }, { "menus/old.yaml": "old" });
    const res = await app.request(`/api/editor-session/${accessToken}/conflicts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conflicts: Array<{ packId: string; diff: { addedOnDisk: string[]; removedOnDisk: string[]; modifiedOnDisk: string[] } }> };
    expect(body.conflicts.length).toBe(1);
    expect(body.conflicts[0].packId).toBe("p_a");
    expect(body.conflicts[0].diff.addedOnDisk).toEqual(["menus/m.yaml"]);
    expect(body.conflicts[0].diff.removedOnDisk).toEqual(["menus/old.yaml"]);
  });

  test("POST resolve choice=editor leaves packBundles unchanged + marks resolved", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-keep");
    const conflictId = await seedConflict(serverKeyId, "p_keep",
      { "a": "diskver" }, { "a": "backendver" });

    const res = await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "editor" }),
    });
    expect(res.status).toBe(200);

    const { db } = await import("../db/index");
    const { packBundles, packConflicts } = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");
    const pack = await db.select().from(packBundles).where(and(
      eq(packBundles.serverId, serverKeyId),
      eq(packBundles.packId, "p_keep"),
    ));
    expect(JSON.parse(pack[0].filesJson)).toEqual({ "a": "backendver" });
    const conflict = await db.select().from(packConflicts).where(eq(packConflicts.id, conflictId));
    expect(conflict[0].resolvedAt).not.toBeNull();
    expect(conflict[0].resolution).toBe("editor");
  });

  test("POST resolve choice=server replaces packBundles.filesJson + marks resolved", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-srv");
    const conflictId = await seedConflict(serverKeyId, "p_srv",
      { "a": "diskver" }, { "a": "backendver" });

    const res = await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "server" }),
    });
    expect(res.status).toBe(200);

    const { db } = await import("../db/index");
    const { packBundles } = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");
    const pack = await db.select().from(packBundles).where(and(
      eq(packBundles.serverId, serverKeyId),
      eq(packBundles.packId, "p_srv"),
    ));
    expect(JSON.parse(pack[0].filesJson)).toEqual({ "a": "diskver" });
  });

  test("POST resolve on already-resolved conflict returns 409", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-409");
    const conflictId = await seedConflict(serverKeyId, "p_409", {}, {});

    await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "editor" }),
    });
    const second = await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "editor" }),
    });
    expect(second.status).toBe(409);
  });

  test("Endpoints reject bad token with 401", async () => {
    const r1 = await app.request(`/api/editor-session/bad_token/conflicts`);
    expect(r1.status).toBe(401);
    const r2 = await app.request(`/api/editor-session/bad_token/conflicts/x/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(r2.status).toBe(401);
  });
});
