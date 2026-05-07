import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { app } from "../app";

describe("GET /api/textures/:version/*", () => {
  const PNG_BYTES = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("diamond_sword")) {
        return new Response(PNG_BYTES, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns 502 when upstream fetch throws", async () => {
    globalThis.fetch = async () => { throw new Error("Network error"); };
    const res = await app.request("/api/textures/1.21.4/item/some_item");
    expect(res.status).toBe(502);
  });

  test("proxies known texture and adds Cache-Control", async () => {
    const res = await app.request("/api/textures/1.21.4/item/diamond_sword");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(PNG_BYTES);
  });

  test("returns 404 when upstream returns 404", async () => {
    const res = await app.request("/api/textures/1.21.4/item/does_not_exist");
    expect(res.status).toBe(404);
  });
});
