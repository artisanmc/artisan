import { afterEach, expect, test, vi } from "vitest";
import { projectClient } from "./projectClient";

afterEach(() => vi.unstubAllGlobals());
test("one immutable project client reads binary descriptors and uses no server URLs", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          files: [{ path: "manifest.yaml", content: "name: Demo" }],
          binaries: [{ path: "textures/a.png", hash: "hash", size: 3 }],
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const result = await projectClient("immutable").read();
  expect(fetcher.mock.calls[0]?.[0]).toContain("/api/v1/projects/immutable/files");
  expect(result).toMatchObject({
    ok: true,
    binaries: [{ path: "textures/a.png", hash: "hash", size: 3 }],
  });
});
test("mixed publication retains its operation ID and exact binary bytes", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  await projectClient("immutable").write({
    operationId: "retry",
    files: [],
    deletes: [],
    binaries: [{ path: "textures/a.png", content_base64: "AP8B", base_hash: null }],
  });
  expect(fetcher.mock.calls[0]?.[0]).toContain("/api/v1/projects/immutable/files");
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toMatchObject({
    operationId: "retry",
    binaries: [{ path: "textures/a.png", content_base64: "AP8B", base_hash: null }],
  });
});
