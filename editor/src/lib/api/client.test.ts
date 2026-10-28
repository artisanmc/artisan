import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiRequest, apiUrl } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("sends the session cookie and JSON bodies, and parses the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiFetch("/api/v1/x", { method: "POST", json: { a: 1 } })).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(apiUrl("/api/v1/x"));
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
  });

  it("turns a refusal into an ApiError carrying the hub's code, status and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "unknown_project", message: "no such folder" }), {
          status: 404,
        }),
      ),
    );
    const error = await apiFetch("/api/v1/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "unknown_project",
      status: 404,
      detail: "no such folder",
      hasCode: true,
      message: "unknown_project",
    });
  });

  it("names a refusal without a code by its status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway", { status: 502 })));
    await expect(apiFetch("/api/v1/x")).rejects.toMatchObject({
      code: "http_502",
      status: 502,
      hasCode: false,
      body: null,
    });
  });

  it("reports a transport failure as network_error with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("/api/v1/x")).rejects.toMatchObject({
      code: "network_error",
      status: 0,
      detail: "Failed to fetch",
    });
  });

  it("reports its own timeout as fetch_timeout, like the hub's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (init.signal?.aborted) reject(init.signal.reason);
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controller.abort(new DOMException("signal timed out", "TimeoutError"));
      return controller.signal;
    });
    await expect(apiFetch("/api/v1/x", { timeoutMs: 10 })).rejects.toMatchObject({
      code: "fetch_timeout",
      status: 504,
    });
  });

  it("rejects a 2xx that is not JSON as invalid_response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(apiFetch("/api/v1/x")).rejects.toMatchObject({
      code: "invalid_response",
      status: 200,
    });
  });
});

describe("apiRequest", () => {
  it("leaves the status to the caller and keeps an absolute URL as is", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await apiRequest("https://hub.example/api/v1/x");
    expect(response.status).toBe(202);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://hub.example/api/v1/x");
  });
});

describe("ApiError.from", () => {
  it("keeps an ApiError and wraps anything else", () => {
    const own = new ApiError("x", 418);
    expect(ApiError.from(own)).toBe(own);
    expect(ApiError.from(new Error("boom"))).toMatchObject({ code: "network_error", status: 0 });
    expect(ApiError.from("?")).toMatchObject({ code: "network_error", status: 0 });
  });
});
