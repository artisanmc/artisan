import { afterEach, describe, expect, it, vi } from "vitest";
import { type ImportSourcesApiError, listImportSources } from "./importSources";

afterEach(() => vi.unstubAllGlobals());

describe("listImportSources", () => {
  it("returns typed source metadata from the contextual Project endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sources: [
              {
                id: "zmenu",
                label: "zMenu",
                files: [{ path: "shop.yml", size: 12 }],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listImportSources("my network", "server/one", "menus #1")).resolves.toEqual({
      ok: true,
      sources: [
        {
          id: "zmenu",
          label: "zMenu",
          files: [{ path: "shop.yml", size: 12 }],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/v1/networks/my%20network/servers/server%2Fone/projects/menus%20%231/import-sources",
      ),
      { credentials: "include" },
    );
  });

  it("rejects invalid JSON from a successful gateway response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );

    await expect(listImportSources("n", "s", "p")).rejects.toEqual(
      expect.objectContaining<Partial<ImportSourcesApiError>>({
        name: "ImportSourcesApiError",
        code: "read_error",
        status: 502,
      }),
    );
  });

  it.each([
    null,
    {},
    { sources: null },
    { sources: [null] },
    { sources: [{ id: 1, label: "zMenu", files: [] }] },
    { sources: [{ id: "zmenu", label: 1, files: [] }] },
    { sources: [{ id: "zmenu", label: "zMenu", files: {} }] },
    { sources: [{ id: "zmenu", label: "zMenu", files: [{ path: 1, size: 1 }] }] },
    { sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: -1 }] }] },
    { sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: null }] }] },
    { sources: [{ id: "zmenu", label: "zMenu", files: [], error: null }] },
    { sources: [{ id: "zmenu", label: "zMenu", files: [], error: "unknown_error" }] },
    { sources: [{ id: "zmenu", label: "zMenu", files: [], error: "x".repeat(1_000) }] },
  ])(
    "rejects malformed successful metadata instead of returning an empty success %#",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
      );

      await expect(listImportSources("n", "s", "p")).rejects.toMatchObject({
        name: "ImportSourcesApiError",
        code: "read_error",
        status: 502,
      });
    },
  );

  it("accepts the bounded public per-source error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sources: [{ id: "zmenu", label: "zMenu", files: [], error: "too_many_entries" }],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(listImportSources("n", "s", "p")).resolves.toEqual({
      ok: true,
      sources: [{ id: "zmenu", label: "zMenu", files: [], error: "too_many_entries" }],
    });
  });

  it("returns server_offline for the expected availability response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "server_offline" }), { status: 503 })),
    );

    await expect(listImportSources("n", "s", "p")).resolves.toEqual({
      ok: false,
      error: "server_offline",
    });
  });

  it("returns fetch_timeout for a timed-out plugin listing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "fetch_timeout" }), { status: 504 })),
    );

    await expect(listImportSources("n", "s", "p")).resolves.toEqual({
      ok: false,
      error: "fetch_timeout",
    });
  });

  it.each(["read_error", "too_many_entries"])(
    "maps the server error %s to read_error",
    async (serverError) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ error: serverError }), { status: 502 })),
      );

      await expect(listImportSources("n", "s", "p")).resolves.toEqual({
        ok: false,
        error: "read_error",
      });
    },
  );

  it("returns network_error when the request cannot reach the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(listImportSources("n", "s", "p")).resolves.toEqual({
      ok: false,
      error: "network_error",
    });
  });
});
