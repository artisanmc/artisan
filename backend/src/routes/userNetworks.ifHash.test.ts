// P2 du cache éditeur : revalider sans rien transporter.
//
// L'éditeur garde la dernière version connue d'un Project et annonce son
// empreinte (`if_hash`). Si l'instantané du serveur porte la même, le plugin
// répond « inchangé » et l'arbre — plusieurs secondes de fichiers — ne traverse
// pas le fil pour annoncer qu'il est identique.
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { linkCodes, memberships, networks, projects, serverKeys, userSessions, users } from "../db/schema";
import { userNetworksRouter } from "./userNetworks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { generateServerKey } from "../lib/auth";
import { connSenders, connToServerId, handlePluginMessage, registerConn } from "../ws/hub";

const SNAPSHOT_HASH = "empreinte-de-l-instantane";

/** Un plugin qui applique la règle du `if_hash`, comme le vrai. */
function fakePlugin(connId: string, serverKeyId: string) {
  const seen: (string | null)[] = [];
  registerConn(connId, (raw: string) => {
    const msg = JSON.parse(raw) as { type: string; request_id: string; if_hash?: string | null };
    if (msg.type !== "project_read") return;
    seen.push(msg.if_hash ?? null);
    const unchanged = msg.if_hash === SNAPSHOT_HASH;
    void handlePluginMessage(
      connId,
      JSON.stringify(
        unchanged
          ? { type: "project_read_result", request_id: msg.request_id, ok: true, unchanged: true, hash: SNAPSHOT_HASH }
          : {
              type: "project_read_result",
              request_id: msg.request_id,
              ok: true,
              hash: SNAPSHOT_HASH,
              files: [{ path: "menus/a.yaml", content: "schema: menu/v1\n" }],
              binaries: [],
              failed: [],
            },
      ),
    );
  });
  connToServerId.set(connId, serverKeyId);
  return {
    seen,
    stop: () => {
      connSenders.delete(connId);
      connToServerId.delete(connId);
    },
  };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/networks/*", userAuth());
  app.route("/api/v1/networks", userNetworksRouter);
  return app;
}

async function seed() {
  const userId = "u_ifhash";
  await db.insert(users).values({
    id: userId,
    email: `${userId}@a.b`,
    name: userId,
    passwordHash: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const session = await createSession(userId);
  const network = await createNetwork("N");
  await addMembership(userId, network.id, "owner");
  const { id: skId, hash } = await generateServerKey();
  await db.insert(serverKeys).values({
    id: skId,
    hash,
    label: null,
    networkId: network.id,
    createdAt: new Date(),
  });
  return { sessionId: session.id, networkId: network.id, serverKeyId: skId };
}

describe("GET …/projects/:projectId/files — revalidation par empreinte", () => {
  beforeEach(async () => {
    await db.delete(projects);
    await db.delete(linkCodes);
    await db.delete(serverKeys);
    await db.delete(memberships);
    await db.delete(networks);
    await db.delete(userSessions);
    await db.delete(users);
  });

  test("une lecture normale rend l'arbre ET son empreinte", async () => {
    const { sessionId, networkId, serverKeyId } = await seed();
    const plugin = fakePlugin("conn-ifhash-1", serverKeyId);
    try {
      const res = await makeApp().request(
        `/api/v1/networks/${networkId}/servers/${serverKeyId}/projects/boutique_shop/files`,
        { headers: { Cookie: `artisan_user_session=${sessionId}` } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hash).toBe(SNAPSHOT_HASH);
      expect(body.files.length).toBe(1);
      expect(plugin.seen).toEqual([null]);
    } finally {
      plugin.stop();
    }
  });

  test("l'empreinte rendue traverse jusqu'au plugin, et « inchangé » revient sans arbre", async () => {
    const { sessionId, networkId, serverKeyId } = await seed();
    const plugin = fakePlugin("conn-ifhash-2", serverKeyId);
    try {
      const res = await makeApp().request(
        `/api/v1/networks/${networkId}/servers/${serverKeyId}/projects/boutique_shop/files?if_hash=${SNAPSHOT_HASH}`,
        { headers: { Cookie: `artisan_user_session=${sessionId}` } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.unchanged).toBe(true);
      expect(body.files).toBeUndefined();
      expect(plugin.seen).toEqual([SNAPSHOT_HASH]);
    } finally {
      plugin.stop();
    }
  });

  test("une empreinte périmée rapatrie l'arbre, elle ne fait pas passer pour inchangé", async () => {
    const { sessionId, networkId, serverKeyId } = await seed();
    const plugin = fakePlugin("conn-ifhash-3", serverKeyId);
    try {
      const res = await makeApp().request(
        `/api/v1/networks/${networkId}/servers/${serverKeyId}/projects/boutique_shop/files?if_hash=vieille-empreinte`,
        { headers: { Cookie: `artisan_user_session=${sessionId}` } },
      );
      const body = await res.json();
      expect(body.unchanged).toBeUndefined();
      expect(body.files.length).toBe(1);
    } finally {
      plugin.stop();
    }
  });
});
