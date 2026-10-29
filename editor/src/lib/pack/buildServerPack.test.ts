// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildServerPack, requestResourcePackRebuild } from "./buildServerPack";
import { diskAssetsFromTree } from "./diskAssets";
import { buildResourcePackZip } from "./resourcePackBuilder";

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const vanilla = (file: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, `../../assets/minecraft/${file}.png`)));

/** Two Projects, each with a glyph at the same codepoint and a menu that uses it. */
function projectTree(id: string, glyph: string) {
  return {
    files: [
      {
        path: `assets/glyphs/${glyph}.yaml`,
        content: "codepoint: 57344\nascent: 8\nheight: 1\nwidth: 1\n",
      },
      {
        path: `menus/${id}.yaml`,
        content: `id: ${id}\ntitle:\n  - kind: glyph\n    asset: ${glyph}\n    x: 0\n    y: 30\n`,
      },
    ],
    binaries: [{ path: `assets/glyphs/${glyph}.png`, hash: `h-${glyph}`, size: PNG_1x1.length }],
  };
}

const TREES: Record<string, ReturnType<typeof projectTree>> = {
  alpha: projectTree("alpha", "coin"),
  beta: projectTree("beta", "gem"),
};

const HUB = "824473e8-413e-4109-ae91-185021a150e9";
const LOBBY = "5f0c1e2a-9b7d-4c3e-8a61-2d4f9e0b7c15";

function mockHub(
  options: { failBinary?: string; server?: string; ids?: string[]; projects?: unknown[] } = {},
) {
  const server = options.server ?? HUB;
  const uploads: Uint8Array[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("data:"))
      return new Response(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    const png = url.match(/(generic_54|hopper|dispenser)[^/]*\.png/);
    if (png) return new Response(vanilla(png[1]!));
    const up = url.match(/(ascii|accented|nonlatin_european)_up[^/]*\.png/);
    if (up) return new Response(vanilla(`font/${up[1]}_up`));
    const { pathname, searchParams } = new URL(url);
    if (pathname === `/api/v1/servers/${server}/projects`)
      // Unordered on purpose: the oldest (by id) must win the codepoint.
      return json({ project_ids: options.ids ?? ["beta", "alpha"], projects: options.projects });
    if (pathname === `/api/v1/servers/${server}/server-config`)
      return json({ config: {}, online: true });
    if (pathname === `/api/v1/servers/${server}/resource-pack` && init?.method === "PUT") {
      uploads.push(init.body as Uint8Array);
      return json({ hash: "abc" });
    }
    const files = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/files$/);
    if (files) {
      const tree = TREES[decodeURIComponent(files[1]!).replace("lobby.", "")];
      return tree
        ? json({ ...tree, failed: [], hash: "h" })
        : json({ error: "unknown_project" }, 404);
    }
    const binary = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/binary$/);
    if (binary) {
      if (searchParams.get("path") === options.failBinary)
        return json({ error: "read_error" }, 502);
      return new Response(PNG_1x1);
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, uploads };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildServerPack", () => {
  test("assembles the same inputs as the backend orchestration", async () => {
    mockHub();
    const built = await buildServerPack(HUB);

    const toFiles = (id: string) => TREES[id]!.files;
    const assets = ["alpha", "beta"].flatMap((id) =>
      diskAssetsFromTree(id, toFiles(id), TREES[id]!.binaries).map((a) => a.row),
    );
    const expected = buildResourcePackZip(
      assets,
      new Map([
        ["coin", PNG_1x1],
        ["gem", PNG_1x1],
      ]),
      new Map(),
      {
        finalCodepoints: new Map([
          ["coin", 0xe000],
          ["gem", 0xe001],
        ]),
      },
      [
        { assetId: "coin", y: 30 },
        { assetId: "gem", y: 30 },
      ],
      [],
      {
        sources: {
          chest: vanilla("generic_54"),
          hopper: vanilla("hopper"),
          dispenser: vanilla("dispenser"),
        },
        transparent: new Set(),
      },
      {
        ascii: vanilla("font/ascii_up"),
        accented: vanilla("font/accented_up"),
        nonlatin_european: vanilla("font/nonlatin_european_up"),
      },
    );
    expect(built.hash).toBe(expected.hash);
    // Byte-for-byte comparison without vitest's deep diff, very slow on a zip.
    expect(Buffer.from(built.zipBytes).equals(Buffer.from(expected.zipBytes))).toBe(true);
  });

  test("a failed read uploads nothing", async () => {
    const { uploads } = mockHub({ failBinary: "assets/glyphs/gem.png" });
    await expect(requestResourcePackRebuild(HUB)).rejects.toThrow();
    expect(uploads).toHaveLength(0);
  });

  test("concurrent requests coalesce: one in flight, at most one queued", async () => {
    const { fetchMock, uploads } = mockHub();
    const first = requestResourcePackRebuild(HUB);
    const second = requestResourcePackRebuild(HUB);
    const third = requestResourcePackRebuild(HUB);
    expect(third).toBe(second);
    expect(second).not.toBe(first);
    await Promise.all([first, second, third]);
    expect(uploads).toHaveLength(2);
    const lists = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/projects"));
    expect(lists).toHaveLength(2);
  });

  test("another server of the network: its own routes and the `<server>.<folder>` ids the hub lists", async () => {
    const { fetchMock, uploads } = mockHub({ server: LOBBY, ids: ["lobby.beta", "lobby.alpha"] });
    await requestResourcePackRebuild(LOBBY);
    expect(uploads).toHaveLength(1);
    const reads = fetchMock.mock.calls
      .map(([url]) => new URL(String(url), "http://x").pathname)
      .filter((path) => path.endsWith("/files"));
    expect(reads).toEqual([
      "/api/v1/projects/lobby.alpha/files",
      "/api/v1/projects/lobby.beta/files",
    ]);
  });

  test("project ids listed by the hub win over the folder name", async () => {
    const { fetchMock } = mockHub({
      server: LOBBY,
      projects: [
        {
          id: "lobby.alpha",
          externalId: "alpha",
          name: "alpha",
          hash: "",
          networkId: "local",
          serverKeyId: LOBBY,
        },
      ],
    });
    await buildServerPack(LOBBY);
    const reads = fetchMock.mock.calls
      .map(([url]) => new URL(String(url), "http://x").pathname)
      .filter((path) => path.endsWith("/files"));
    expect(reads).toEqual(["/api/v1/projects/beta/files", "/api/v1/projects/lobby.alpha/files"]);
  });
});
