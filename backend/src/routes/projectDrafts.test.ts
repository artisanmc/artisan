import { beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db";
import { networks, projects, serverKeys, users } from "../db/schema";
import { addMembership } from "../lib/membershipManager";
import type { AuthUser } from "../middleware/userAuth";
import { cleanupConn, connToServerId, handlePluginMessage, registerConn } from "../ws/hub";
import { projectDraftsRouter } from "./projectDrafts";

const app = new Hono<{ Variables: { user: AuthUser | null } }>();
app.use("*", async (c, next) => {
  c.set("user", c.req.header("x-user") ? ({ id: c.req.header("x-user") } as AuthUser) : null);
  await next();
});
app.route("/projects", projectDraftsRouter);
const snapshot = {
  baseline: { "manifest.yaml": "id: shop\n" },
  tree: { "manifest.yaml": "id: shop\nname: Edited\n" },
  at: 123,
};

test("the mounted application requires authentication for the draft collection", async () => {
  const { app: mounted } = await import("../app");
  for (const [suffix, method] of [
    ["", "GET"],
    ["", "POST"],
    ["/one", "GET"],
    ["/one", "PUT"],
    ["/one", "DELETE"],
    ["/one/publish", "POST"],
  ]) {
    const result = await mounted.request(`/api/v1/user/projects/draft-project/drafts${suffix}`, {
      method,
    });
    expect(result.status).toBe(401);
  }
});
function request(path = "", method = "GET", body?: unknown, user = "draft-user") {
  return app.request(`/projects/draft-project/drafts${path}`, {
    method,
    headers: { "x-user": user, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  await db.delete(networks);
  await db.delete(users);
  const now = new Date();
  await db.insert(users).values(
    ["draft-user", "other-user"].map((id) => ({
      id,
      email: `${id}@example.com`,
      name: id,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db
    .insert(networks)
    .values({ id: "draft-network", name: "Drafts", createdAt: now, updatedAt: now });
  await addMembership("draft-user", "draft-network", "owner");
  await addMembership("other-user", "draft-network", "member");
  await db
    .insert(serverKeys)
    .values({ id: "draft-server", hash: "draft-hash", networkId: "draft-network", createdAt: now });
  await db.insert(projects).values({
    id: "draft-project",
    externalId: "shop",
    name: "Shop",
    networkId: "draft-network",
    serverKeyId: "draft-server",
    createdAt: now,
    updatedAt: now,
  });
});

test("a named draft survives a new request while the Minecraft server is offline", async () => {
  const created = await request("", "POST", { id: "draft-one", name: "Shop redesign", snapshot });
  expect(created.status).toBe(201);
  const read = await request("/draft-one");
  expect(read.status).toBe(200);
  expect((await read.json()).draft).toMatchObject({
    id: "draft-one",
    name: "Shop redesign",
    revision: 1,
    ownerId: "draft-user",
    snapshot,
  });
  expect((await (await request()).json()).drafts).toHaveLength(1);
});

test("two editors cannot overwrite the same revision or access another owner's draft", async () => {
  await request("", "POST", { id: "draft-one", name: "First", snapshot });
  const results = await Promise.all(
    ["A", "B"].map((name) => request("/draft-one", "PUT", { revision: 1, name, snapshot })),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await (await request("/draft-one")).json()).draft.revision).toBe(2);
  expect((await request("/draft-one", "GET", undefined, "other-user")).status).toBe(404);
  expect(
    (await request("/draft-one", "PUT", { revision: 2, name: "Stolen", snapshot }, "other-user"))
      .status,
  ).toBe(404);
  expect((await request("/draft-one", "DELETE", { revision: 1 })).status).toBe(409);
  expect((await request("/draft-one", "DELETE", { revision: 2 })).status).toBe(200);
  expect((await (await request()).json()).drafts).toEqual([]);
});

test("invalid trees are rejected and retrying creation never replaces an existing draft", async () => {
  for (const path of ["../secret", "/absolute", "a\\b", "__proto__", ".artisan/history/x"]) {
    expect(
      (
        await request("", "POST", {
          id: "invalid",
          name: "Invalid",
          snapshot: { ...snapshot, tree: { [path]: "bad" } },
        })
      ).status,
    ).toBe(422);
  }
  expect((await request("", "POST", { id: "invalid", name: "", snapshot })).status).toBe(422);
  await request("", "POST", { id: "draft-one", name: "First", snapshot });
  expect((await request("", "POST", { id: "draft-one", name: "Retry", snapshot })).status).toBe(
    409,
  );
  expect((await (await request("/draft-one")).json()).draft.name).toBe("First");
});

test("publication uses the saved baseline and preserves the draft on a disk conflict", async () => {
  const writes: { project_id: string; files: { path: string; base_hash: string | null }[] }[] = [];
  let conflict = true;
  registerConn("draft-connection", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type !== "project_write") return;
    writes.push(msg);
    void handlePluginMessage(
      "draft-connection",
      JSON.stringify({
        type: "project_write_result",
        request_id: msg.request_id,
        ok: !conflict,
        ...(conflict
          ? { error: "conflict", conflicts: [{ path: "manifest.yaml", disk: "changed on disk" }] }
          : {}),
      }),
    );
  });
  connToServerId.set("draft-connection", "draft-server");
  try {
    await request("", "POST", { id: "draft-one", name: "First", snapshot });
    expect(writes).toHaveLength(0);
    expect((await request("/draft-one/publish", "POST", { revision: 9 })).status).toBe(409);
    expect(writes).toHaveLength(0);
    expect((await request("/draft-one/publish", "POST", { revision: 1 })).status).toBe(409);
    expect((await (await request("/draft-one")).json()).draft.status).toBe("active");
    expect(writes[0].project_id).toBe("shop");
    expect(writes[0].files[0].base_hash).toBe(
      new Bun.CryptoHasher("sha256").update(snapshot.baseline["manifest.yaml"]).digest("hex"),
    );
    conflict = false;
    expect((await request("/draft-one/publish", "POST", { revision: 1 })).status).toBe(200);
    expect((await (await request("/draft-one")).json()).draft.status).toBe("published");
  } finally {
    cleanupConn("draft-connection");
  }
});
