import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { db } from "../db/index";
import {serverKeys, projects, networks, linkCodes} from "../db/schema";
import { createHash } from "crypto";
import { forgetAllProjectTrees } from "./projectTreeReads";
import { resourcePackRoot, resourcePackPath } from "./resourcePackStorage";
import { rebuildResourcePack, currentPackInfo } from "./resourcePack";
import { createNetwork } from "./networkManager";
import { createProject } from "./projectStorage";
import { registerConn, connToServerId, connSenders, handlePluginMessage } from "../ws/hub";
import { unzipSync } from "fflate";
import { join } from "path";

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

async function seedSetup(): Promise<{ serverKeyId: string; projectId: string }> {
  const net = await createNetwork("N");
  const serverKeyId = crypto.randomUUID();
  await db.insert(serverKeys).values({
    id: serverKeyId,
    hash: "h" + serverKeyId.slice(0, 8),
    networkId: net.id,
    createdAt: new Date(),
  });
  const project = await createProject({ networkId: net.id, serverKeyId, name: "p" });
  return { serverKeyId, projectId: project.id };
}

/**
 * Les disques des serveurs, par id de Project — la seule source d'assets depuis
 * P6. Semer en base ne produit plus rien : c'est exactement ce qu'on veut lire
 * dans ces tests.
 */
const disks = new Map<string, Map<string, Uint8Array>>();

function diskOf(diskProjectId: string): Map<string, Uint8Array> {
  let d = disks.get(diskProjectId);
  if (!d) {
    d = new Map();
    disks.set(diskProjectId, d);
  }
  return d;
}

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/** Un faux plugin qui sert les arbres de `disks`, pour tous leurs Projects. */
function serveDisks(connId: string, serverKeyId: string): () => void {
  registerConn(connId, (raw: string) => {
    const msg = JSON.parse(raw) as { type: string; request_id: string; project_id?: string; path?: string };
    if (msg.type === "project_read") {
      const tree = disks.get(msg.project_id ?? "") ?? new Map<string, Uint8Array>();
      const files: { path: string; content: string }[] = [];
      const binaries: { path: string; hash: string; size: number }[] = [];
      for (const [path, bytes] of tree) {
        if (path.endsWith(".yaml")) files.push({ path, content: new TextDecoder().decode(bytes) });
        else binaries.push({ path, hash: hashOf(bytes), size: bytes.length });
      }
      void handlePluginMessage(connId, JSON.stringify({
        type: "project_read_result", request_id: msg.request_id, ok: true, files, binaries,
      }));
      return;
    }
    if (msg.type === "asset_read") {
      const bytes = [...disks.values()].map((t) => t.get(msg.path ?? "")).find(Boolean);
      void handlePluginMessage(connId, JSON.stringify(
        bytes
          ? {
              type: "asset_read_result", request_id: msg.request_id, ok: true,
              content_base64: Buffer.from(bytes).toString("base64"), hash: hashOf(bytes),
            }
          : { type: "asset_read_result", request_id: msg.request_id, ok: false, error: "not_found" },
      ));
    }
  });
  connToServerId.set(connId, serverKeyId);
  return () => {
    connSenders.delete(connId);
    connToServerId.delete(connId);
  };
}

/** Un glyphe SUR LE DISQUE du serveur. Rend l'id que le pack lui donnera. */
function seedGlyph(diskProjectId: string, name: string, codepoint: number): string {
  const tree = diskOf(diskProjectId);
  tree.set(
    `assets/glyphs/${name}.yaml`,
    new TextEncoder().encode(
      `ascent: 0\ncodepoint: ${codepoint}\nwidth: 1\nheight: 1\n`,
    ),
  );
  tree.set(`assets/glyphs/${name}.png`, PNG_1x1);
  // Le disque vient de changer sans passer par nos écritures : ce qu'on avait
  // mémorisé de son arbre ne vaut plus rien.
  forgetAllProjectTrees();
  return name;
}

let serverKeyId: string;
let projectId: string;

let stopServing: () => void = () => {};

beforeEach(async () => {
  // FK-safe cleanup
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networks);
  disks.clear();
  ({ serverKeyId, projectId } = await seedSetup());
  stopServing = serveDisks(`conn-rp-${serverKeyId}`, serverKeyId);
});

afterEach(async () => {
  stopServing();
  await rm(join(resourcePackRoot(), serverKeyId), { recursive: true, force: true });
});

describe("rebuildResourcePack", () => {
  test("writes a zip and updates server_keys columns", async () => {
    seedGlyph(projectId, "coin", 0xE000);
    const { hash, url } = await rebuildResourcePack(serverKeyId);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(url).toMatch(new RegExp(`/api/v1/resource-pack/${serverKeyId}/${hash}\\.zip$`));
    expect(existsSync(resourcePackPath(serverKeyId, hash))).toBe(true);

    const rows = await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId));
    expect(rows[0].resourcePackHash).toBe(hash);
    expect(rows[0].resourcePackUpdatedAt).toBeInstanceOf(Date);
  });

  test("two consecutive rebuilds with same assets produce the same hash", async () => {
    seedGlyph(projectId, "coin", 0xE000);
    const r1 = await rebuildResourcePack(serverKeyId);
    const r2 = await rebuildResourcePack(serverKeyId);
    expect(r1.hash).toBe(r2.hash);
  });

  test("adding a glyph changes the hash", async () => {
    const r1 = await rebuildResourcePack(serverKeyId);
    seedGlyph(projectId, "coin", 0xE000);
    const r2 = await rebuildResourcePack(serverKeyId);
    expect(r2.hash).not.toBe(r1.hash);
  });

  test("keeps at most 3 projects on disk plus the current one", async () => {
    for (let i = 0; i < 5; i++) {
      seedGlyph(projectId, `g${i}`, 0xE000 + i);
      await rebuildResourcePack(serverKeyId);
      await new Promise((r) => setTimeout(r, 15));
    }
    const { hash } = await rebuildResourcePack(serverKeyId);
    expect(existsSync(resourcePackPath(serverKeyId, hash))).toBe(true);

    const { readdir } = await import("fs/promises");
    const files = await readdir(join(resourcePackRoot(), serverKeyId));
    expect(files.filter((f) => f.endsWith(".zip")).length).toBeLessThanOrEqual(3);
  });

  test("currentPackInfo returns null when never built", async () => {
    expect(await currentPackInfo(serverKeyId)).toBeNull();
  });

  test("currentPackInfo returns { url, hash } after a build", async () => {
    seedGlyph(projectId, "coin", 0xE000);
    const { hash } = await rebuildResourcePack(serverKeyId);
    const info = await currentPackInfo(serverKeyId);
    expect(info).not.toBeNull();
    expect(info!.hash).toBe(hash);
    expect(info!.url.endsWith(`/api/v1/resource-pack/${serverKeyId}/${hash}.zip`)).toBe(true);
  });

  test("multi-project: server_key bound to 2 projects with colliding codepoints → asset-index has distinct final codepoints", async () => {
    // The seedSetup fixture already created `projectId` (project A) for serverKeyId.
    // Add a second bound project B with a glyph that collides at the same codepoint.
    const skRow = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0]!;
    const projectB = await createProject({ networkId: skRow.networkId, serverKeyId, name: "pb" });

    const glyphAId = seedGlyph(projectId, "alpha", 0xE000);
    const glyphBId = seedGlyph(projectB.id, "beta", 0xE000);

    const { hash } = await rebuildResourcePack(serverKeyId);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    // Inspect the produced zip to read asset-index.json.
    const { unzipSync, strFromU8 } = await import("fflate");
    const { readFile } = await import("fs/promises");
    const zipBytes = await readFile(resourcePackPath(serverKeyId, hash));
    const entries = unzipSync(new Uint8Array(zipBytes));
    const indexBytes = entries["assets/artisan/asset-index.json"]!;
    const index = JSON.parse(strFromU8(indexBytes)) as {
      assets: Record<string, { codepoint?: number }>;
    };

    // First project (oldest createdAt) keeps 0xE000; second project gets remapped to 0xE001.
    expect(index.assets[glyphAId].codepoint).toBe(0xE000);
    expect(index.assets[glyphBId].codepoint).toBe(0xE001);
  });
});

/**
 * La source du pack devient le **disque du serveur** (ADR
 * `assets-on-server-disk`, P4).
 *
 * Le pack reste construit et hébergé ici — il lui faut une URL publique pour le
 * client Minecraft — mais ses octets viennent du serveur, plus de la table.
 */
describe("rebuildResourcePack — source disque", () => {
  /** Faux plugin servant un Project dont les assets vivent sur son disque. */
  function fakePlugin(connId: string, serverKeyId: string, glyphHash: string) {
    registerConn(connId, (raw: string) => {
      const msg = JSON.parse(raw) as { type: string; request_id: string };
      if (msg.type === "project_read") {
        void handlePluginMessage(connId, JSON.stringify({
          type: "project_read_result", request_id: msg.request_id, ok: true,
          files: [{
            path: "assets/glyphs/du_disque.yaml",
            content: ["ascent: 8", "codepoint: 57345", "width: 1", "height: 1", ""].join("\n"),
          }],
          binaries: [{ path: "assets/glyphs/du_disque.png", hash: glyphHash, size: PNG_1x1.length }],
        }));
      } else if (msg.type === "asset_read") {
        void handlePluginMessage(connId, JSON.stringify({
          type: "asset_read_result", request_id: msg.request_id, ok: true,
          content_base64: Buffer.from(PNG_1x1).toString("base64"), hash: glyphHash,
        }));
      }
    });
    connToServerId.set(connId, serverKeyId);
    return () => { connSenders.delete(connId); connToServerId.delete(connId); };
  }

  test("les glyphes du disque entrent dans le pack, et la table est ignorée", async () => {
    const { serverKeyId, projectId } = await seedSetup();
    // Une ligne en base qui ne doit PAS gagner : le disque décide.
    seedGlyph(projectId, "de_la_table", 57344);
    const stop = fakePlugin("conn-rp-disk", serverKeyId, "hash_du_disque");
    try {
      const info = await rebuildResourcePack(serverKeyId);
      const zip = unzipSync(await Bun.file(resourcePackPath(serverKeyId, info.hash)).bytes());
      const index = JSON.parse(new TextDecoder().decode(zip["assets/artisan/asset-index.json"]!));
      const ids = Object.keys(index.assets ?? index);
      expect(ids).toContain("du_disque");
      expect(ids).not.toContain("de_la_table");
    } finally {
      stop();
    }
  });

  test("sans rien sur le disque, la table ne ressuscite rien (P6)", async () => {
    // Le disque est la seule source : une ligne restée en base n'a plus voix.
    const { serverKeyId, projectId } = await seedSetup();
    seedGlyph(projectId, "de_la_table", 57344);
    const info = await rebuildResourcePack(serverKeyId);
    const zip = unzipSync(await Bun.file(resourcePackPath(serverKeyId, info.hash)).bytes());
    const index = JSON.parse(new TextDecoder().decode(zip["assets/artisan/asset-index.json"]!));
    expect(JSON.stringify(index)).not.toContain("de_la_table");
  });

  /**
   * Le pack part chez les joueurs. Le reconstruire pendant qu'un Project est
   * illisible publierait un pack amputé de tous ses glyphes — des carrés à la
   * place des lettres, pour tout le monde, jusqu'à la prochaine écriture. Mieux
   * vaut garder le pack précédent : il est peut-être en retard, il n'est pas faux.
   */
  test("un Project illisible ne publie pas un pack amputé : le précédent tient", async () => {
    const { serverKeyId } = await seedSetup();
    const stop = fakePlugin("conn-rp-keep", serverKeyId, "hash_du_disque");
    const built = await rebuildResourcePack(serverKeyId);
    stop();

    const after = await rebuildResourcePack(serverKeyId);
    expect(after.hash).toBe(built.hash);
    const zip = unzipSync(await Bun.file(resourcePackPath(serverKeyId, after.hash)).bytes());
    const index = JSON.parse(new TextDecoder().decode(zip["assets/artisan/asset-index.json"]!));
    expect(JSON.stringify(index)).toContain("du_disque");
  });
});
