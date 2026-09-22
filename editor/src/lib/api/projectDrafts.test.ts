import { projectFetch } from "@/lib/projectFetch";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftApiError, publishDraft } from "./projectDrafts";

vi.mock("@/lib/projectFetch", () => ({ projectFetch: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function respondAfter(milliseconds: number, body: unknown, status = 200) {
  vi.mocked(projectFetch).mockImplementation(
    (_project, _url, options) =>
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

it("waits for the backend's 30-second timeout and preserves its structured error", async () => {
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
  ).rejects.toBeInstanceOf(DraftApiError);
  await Promise.all([assertion, vi.advanceTimersByTimeAsync(45_000)]);
  expect(JSON.parse(String(vi.mocked(projectFetch).mock.calls[0]?.[2]?.body))).toEqual({
    revision: 2,
    operationId: "same-operation",
  });
});
