import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { app, websocket } from "./app";
import { db } from "./db/index";
import { networks, serverKeys, projects, linkCodes } from "./db/schema";
import { getProject } from "./lib/projectStorage";
import {adminCookie} from './testSupport/adminSession';

/**
 * Full-stack: a real Bun HTTP/WS server, a real socket.
 *
 * Ce fichier testait la synchro de bundle (upload → `needs_sync` →
 * `bundle_available` → download). Tout cela a disparu avec le stockage backend
 * (ADR `server-disk-only-storage`) : le contenu ne transite plus par le backend.
 * Ce qui reste vrai, et qui n'est testé nulle part ailleurs sur un vrai
 * transport, c'est la poignée de main — et le fait qu'elle enregistre
 * l'**identité** des Projects que le serveur porte sur son disque.
 */
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
});

afterAll(() => {
  server.stop(true);
});

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
    headers: { "Content-Type": "application/json",Cookie:await adminCookie() },
    body: JSON.stringify({ label }),
  });
  return ((await res.json()) as { key: string }).key;
}

describe("full-stack: WS handshake over a real socket", () => {
  test("hello → hello_ack, and nothing is pushed afterwards", async () => {
    const key = await createKey("integration");
    const ws = await connectWs();
    // On demande DEUX messages : si le backend poussait encore quoi que ce soit
    // après l'ack, il arriverait ici. Le timeout est le test.
    const pending = collectMessages(ws, 2, 1_000);
    ws.send(JSON.stringify({
      type: "hello", content_version: 2,
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    }));
    const msgs = await pending;

    expect(msgs).toHaveLength(1);
    const ack = JSON.parse(msgs[0]!) as Record<string, unknown>;
    expect(ack.type).toBe("hello_ack");
    expect(ack.session_id).toBeDefined();
    // Les champs de synchro ont disparu du contrat.
    expect(ack.needs_sync).toBeUndefined();
    expect(ack.project_hashes).toBeUndefined();
    expect(ack.latest_bundle_hash).toBeUndefined();
    ws.close();
  });

  test("hello enregistre l'identité des Projects présents sur le disque du serveur", async () => {
    const key = await createKey("integration-ids");
    const ws = await connectWs();
    const pending = collectMessages(ws, 1);
    ws.send(JSON.stringify({
      type: "hello", content_version: 2,
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
      local_project_ids: ["p_shop"],
    }));
    await pending;

    // Pas de contenu — juste de quoi lister et router le Project dans l'éditeur.
    const row = await getProject("p_shop");
    expect(row).not.toBeNull();
    expect(row!.name).toBe("p_shop");
    ws.close();
  });
});
