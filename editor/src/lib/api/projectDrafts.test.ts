import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftApiError, publishDraft } from "./projectDrafts";

const fetchMock = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException("signal timed out", "TimeoutError")),
      milliseconds,
    );
    return controller.signal;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function respondAfter(milliseconds: number, body: unknown, status = 200) {
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(new Response(JSON.stringify(body), { status })),
          milliseconds,
        );
        options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason);
          },
          { once: true },
        );
      }),
  );
}

it("accepts a successful publication acknowledged after 28 seconds", async () => {
  const result = { draft: { status: "published" }, wrote: 10 };
  respondAfter(28_000, result);
  const assertion = expect(publishDraft("project", "draft", 2, "same-operation")).resolves.toEqual(
    result,
  );
  await Promise.all([assertion, vi.advanceTimersByTimeAsync(28_000)]);
});

it("waits for the hub's 30-second timeout and preserves its structured error", async () => {
  respondAfter(30_000, { error: "fetch_timeout" }, 504);
  const assertion = expect(
    publishDraft("project", "draft", 2, "same-operation"),
  ).rejects.toMatchObject({ code: "fetch_timeout", status: 504 });
  await Promise.all([assertion, vi.advanceTimersByTimeAsync(30_000)]);
});

it("reports an unanswered transport as a retryable timeout with a stable operation ID", async () => {
  respondAfter(90_000, {});
  const assertion = expect(
    publishDraft("project", "draft", 2, "same-operation"),
  ).rejects.toMatchObject({ code: "fetch_timeout", status: 504 });
  await Promise.all([assertion, vi.advanceTimersByTimeAsync(45_000)]);
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    revision: 2,
    operationId: "same-operation",
  });
});

it("carries the server's draft and conflicts on a refusal, as a DraftApiError", async () => {
  respondAfter(
    0,
    {
      error: "draft_conflict",
      message: "revision 3 is current",
      draft: { id: "draft", revision: 3 },
      conflicts: [{ path: "m.yaml", disk: "B" }],
      disk_files: ["m.yaml"],
    },
    409,
  );
  const assertion = expect(publishDraft("project", "draft", 2, "op")).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof DraftApiError &&
      error.code === "draft_conflict" &&
      error.status === 409 &&
      error.detail === "revision 3 is current" &&
      error.draft?.revision === 3 &&
      error.conflicts[0]?.path === "m.yaml" &&
      error.diskFiles[0] === "m.yaml",
  );
  await Promise.all([assertion, vi.advanceTimersByTimeAsync(0)]);
});
