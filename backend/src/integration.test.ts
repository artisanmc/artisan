import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { app, websocket } from "./app";
import { db } from "./db/index";
import { networks, serverKeys, projects, linkCodes } from "./db/schema";
import { createCommit } from "./lib/commitStorage";
import { getBranch, advanceBranchHead } from "./lib/branchStorage";

// Start a real Bun HTTP/WS server on a random port for full-stack integration tests.
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
});

afterAll(() => {
  server.stop(true);
});

// Each test creates its own server key + p_shop. Clear shared state so a fixed
// project id can't leak ownership across tests (or across reused test-DB runs).
beforeEach(async () => {
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networks);
});

async function connectWs(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${server.port}/ws/plugin`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("WS connection failed")));
  });
  return ws;
}

// Collects up to `count` messages, or resolves after `timeoutMs` with whatever arrived.
function collectMessages(ws: WebSocket, count: number, timeoutMs = 3_000): Promise<string[]> {
  return new Promise((resolve) => {
    const msgs: string[] = [];
    const timer = setTimeout(() => resolve(msgs), timeoutMs);
    ws.addEventListener("message", (e) => {
      msgs.push(e.data as string);
      if (msgs.length >= count) {
        clearTimeout(timer);
        resolve(msgs);
      }
    });
  });
}

async function createKey(label: string): Promise<string> {
  const res = await app.request("/api/v1/server-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  return ((await res.json()) as { key: string }).key;
}

async function uploadBundle(key: string, projectId: string, files: Record<string, string>): Promise<string> {
  const res = await app.request(`/api/v1/bundles/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ files }),
  });
  return ((await res.json()) as { hash: string }).hash;
}

// Commit content onto the project's main branch and advance the head, so the branch
// head carries real (non-empty) content — the state in which the backend pushes a
// bundle_available. POST /bundles only writes WIP; sync serves the committed head.
async function commitToMain(projectId: string, files: Record<string, string>): Promise<string> {
  const branch = await getBranch(projectId, "main");
  const cmt = await createCommit({
    projectId: projectId,
    parentId: branch!.headCommitId,
    files,
    editor: null,
    authorUserId: null,
    message: "integration content",
  });
  await advanceBranchHead(projectId, "main", cmt.id);
  return cmt.contentHash;
}

const PACK_FILES = {
  "plugins/Artisan/projects/p_shop/manifest.yaml": "schema: manifest/v1\nproject_id: p_shop\n",
  "plugins/Artisan/projects/p_shop/menus/shop.yaml": "id: shop\nsize: 27\n",
};

describe("full-stack integration: WS handshake + bundle sync", () => {
  test("hello → hello_ack contains project_hashes and api_url", async () => {
    const key = await createKey("integ-basic");
    const ws = await connectWs();
    const msgs = collectMessages(ws, 1);

    ws.send(JSON.stringify({
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    }));

    const [raw] = await msgs;
    const ack = JSON.parse(raw);
    expect(ack.type).toBe("hello_ack");
    expect(typeof ack.project_hashes).toBe("object");
    expect(ack.api_url).toContain("localhost");
    expect(ack.needs_sync).toBe(false);
    ws.close();
  });

  test("upload bundle → stale hash → hello_ack needs_sync=true + bundle_available pushed", async () => {
    const key = await createKey("integ-sync");
    await uploadBundle(key, "p_shop", PACK_FILES);
    // Commit the content so the branch head is non-empty — only then is a
    // bundle_available pushed (an empty head hashes to "" and is correctly skipped).
    await commitToMain("p_shop", PACK_FILES);

    const ws = await connectWs();
    const msgs = collectMessages(ws, 2); // hello_ack + bundle_available

    ws.send(JSON.stringify({
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "stale",
    }));

    const [ackRaw, availRaw] = await msgs;

    const ack = JSON.parse(ackRaw);
    expect(ack.type).toBe("hello_ack");
    expect(ack.needs_sync).toBe(true);
    // Branch head now carries committed content → non-empty content hash.
    expect(ack.project_hashes["p_shop"]).toMatch(/^[0-9a-f]{64}$/);

    const avail = JSON.parse(availRaw);
    expect(avail.type).toBe("bundle_available");
    expect(avail.project_id).toBe("p_shop");
    expect(avail.url).toContain("/api/v1/bundles/p_shop");
    expect(avail.hash).toMatch(/^[0-9a-f]{64}$/);
    ws.close();
  });

  test("current hash → hello_ack needs_sync=false, no bundle_available", async () => {
    const key = await createKey("integ-insync");
    await uploadBundle(key, "p_shop", PACK_FILES);

    // First connection to get current hash
    const ws1 = await connectWs();
    const msgs1 = collectMessages(ws1, 1);
    ws1.send(JSON.stringify({ type: "hello", server_key: key, plugin_version: "1.0.0", minecraft_version: "1.21.4", current_bundle_hash: "" }));
    const [firstAck] = await msgs1;
    ws1.close();
    const { latest_bundle_hash } = JSON.parse(firstAck);

    // Second connection with the correct current hash
    const ws2 = await connectWs();
    const msgs2 = collectMessages(ws2, 2, 500); // wait 500 ms for any extra messages
    ws2.send(JSON.stringify({ type: "hello", server_key: key, plugin_version: "1.0.0", minecraft_version: "1.21.4", current_bundle_hash: latest_bundle_hash }));

    const received = await msgs2;
    expect(received.length).toBe(1);
    const ack = JSON.parse(received[0]);
    expect(ack.type).toBe("hello_ack");
    expect(ack.needs_sync).toBe(false);
    ws2.close();
  });

  test("GET /api/v1/bundles/:projectId serves branch head commit content (not WIP)", async () => {
    const key = await createKey("integ-download");
    // Use a unique project id to avoid collision with other tests that also uploaded p_shop
    const uniquePackId = "p_dl_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    // POST writes WIP only — GET serves the main branch head commit (initial empty commit).
    await uploadBundle(key, uniquePackId, {
      [`plugins/Artisan/projects/${uniquePackId}/manifest.yaml`]: "schema: manifest/v1\n",
    });

    const downloadRes = await app.request(`/api/v1/bundles/${uniquePackId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(downloadRes.status).toBe(200);
    const bundle = (await downloadRes.json()) as { files: Record<string, string>; hash: string };
    // Branch head is the initial empty commit; POST WIP is not reflected until a commit is created.
    expect(bundle.files).toEqual({});
  });
});
