// Module mocks MUST be declared before any import of the mocked modules.
import { mock } from "bun:test";
mock.module("../lib/resourcePack", () => ({
  rebuildResourcePack: async () => ({ url: "stub://rp", hash: "stubbedHash" }),
  currentPackInfo: async () => null,
}));
import { clearFakeDisk, diskBinary, diskText, fakeHubModule } from "../test/fakeServerDisk";
mock.module("../ws/hub", () => fakeHubModule());

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {serverKeys, networks, projects, users, memberships} from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { texturesRouter } from "./textures";

// ─── Local app (avoids importing hub/bundles) ────────────────────────────────

const routed = new Hono();
routed.route("/api/v1/textures", texturesRouter);
let cookie = "";
const app = { request: (input: string, init?: RequestInit) => routed.request(input, { ...init, headers: { Cookie: cookie, ...init?.headers } }) };

// ─── Cleanup ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  clearFakeDisk();
  await db.delete(projects);
  await db.delete(serverKeys);
  await db.delete(networks);
  await db.delete(users);
  const now = new Date();
  await db.insert(users).values({ id: "texture-owner", email: "texture@test", name: "Texture", createdAt: now, updatedAt: now });
  cookie = `artisan_user_session=${(await createSession("texture-owner")).id}`;
});

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

async function seedSession(): Promise<{ projectId: string }> {
  const networkId = crypto.randomUUID();
  await db.insert(networks).values({
    id: networkId,
    name: "test-network",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const serverKeyId = crypto.randomUUID();
  const now = new Date();
  await db.insert(memberships).values({ id: crypto.randomUUID(), userId: "texture-owner", networkId, role: "owner", createdAt: now });
  await db.insert(serverKeys).values({
    id: serverKeyId,
    networkId,
    hash: "h" + serverKeyId.slice(0, 8),
    createdAt: new Date(),
  });

  const projectId = "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(projects).values({
    id: projectId,
    networkId,
    serverKeyId,
    name: "test-project",
    hash: "",
    filesJson: "{}",
    createdAt: now,
    updatedAt: now,
  });

  return { projectId };
}

describe("GET /api/v1/textures/asset/:projectId/:assetId", () => {
  test("sert le PNG lu sur le disque du serveur", async () => {
    const { projectId } = await seedSession();
    diskText.set("assets/textures/tex_serve.yaml", `width: 1\nheight: 1\n`);
    diskBinary.set("assets/textures/tex_serve.png", PNG_1x1);

    const res = await app.request(`/api/v1/textures/asset/${projectId}/tex_serve`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_1x1.length);
  });

  test("404 for unknown id", async () => {
    const res = await app.request(`/api/v1/textures/asset/pack_no/asset_no`);
    expect(res.status).toBe(404);
  });

  test("rejects path traversal attempts", async () => {
    const res = await app.request(`/api/v1/textures/asset/project/..%2F..%2Fetc%2Fpasswd`);
    expect([400, 404]).toContain(res.status);
  });
});

describe("GET /api/v1/textures/asset-font/:assetId/*", () => {
  /** Pose une police sur le disque : un dossier, son descripteur, ses PNG. */
  function seedFontOnDisk(name: string, glyphs: Record<string, Uint8Array>) {
    diskText.set(
      `assets/fonts/${name}/font.yaml`,
      [
        `namespace: artisan:${name}`,
        "glyphs:",
        ...Object.keys(glyphs).flatMap((texture) => [
          `  - char: a`,
          `    texture: ${texture}`,
          "    ascent: 8",
          "    height: 8",
          "    width: 8",
        ]),
        "",
      ].join("\n"),
    );
    for (const [texture, bytes] of Object.entries(glyphs)) {
      diskBinary.set(`assets/fonts/${name}/${texture}`, bytes);
    }
  }

  test("sert un glyphe de police depuis le dossier de la police, sur le disque", async () => {
    const { projectId } = await seedSession();
    diskText.set(
      "assets/fonts/mafonte/font.yaml",
      [
        "namespace: artisan:mafonte",
        "glyphs:",
        "  - char: a",
        "    texture: a.png",
        "    ascent: 8",
        "    height: 8",
        "    width: 8",
        "",
      ].join("\n"),
    );
    diskBinary.set("assets/fonts/mafonte/a.png", PNG_1x1);

    const res = await app.request(`/api/v1/textures/asset-font/${projectId}/mafonte/a.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_1x1.length);
  });

  test("404 quand le nom désigne autre chose qu'une police", async () => {
    const { projectId } = await seedSession();
    diskText.set("assets/textures/pasunepolice.yaml", `width: 1\nheight: 1\n`);
    diskBinary.set("assets/textures/pasunepolice.png", PNG_1x1);

    const res = await app.request(
      `/api/v1/textures/asset-font/${projectId}/pasunepolice/a.png`,
    );
    expect(res.status).toBe(404);
  });

  test("404 pour une police inconnue", async () => {
    const { projectId } = await seedSession();
    const res = await app.request(`/api/v1/textures/asset-font/${projectId}/absente/a.png`);
    expect(res.status).toBe(404);
  });

  test("404 (silencieux) sur une tentative de remontée de chemin", async () => {
    const { projectId } = await seedSession();
    seedFontOnDisk("mafonte", { "a.png": PNG_1x1 });

    const res = await app.request(
      `/api/v1/textures/asset-font/${projectId}/mafonte/../escape.png`,
    );
    expect(res.status).toBe(404);
  });

  test("404 quand la police existe mais pas le fichier demandé", async () => {
    const { projectId } = await seedSession();
    seedFontOnDisk("mafonte", { "a.png": PNG_1x1 });

    const res = await app.request(
      `/api/v1/textures/asset-font/${projectId}/mafonte/absent.png`,
    );
    expect(res.status).toBe(404);
  });
});
