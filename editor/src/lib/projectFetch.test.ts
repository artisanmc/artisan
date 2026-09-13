import { useDemoStore } from "@/state/demoStore";
import { afterEach, expect, test, vi } from "vitest";
import { projectFetch } from "./projectFetch";
afterEach(() => {
  vi.unstubAllGlobals();
  useDemoStore.getState().setSession(null);
});
test("guest mutation carries CSRF only for its project and refreshes the authoritative expiry", async () => {
  useDemoStore
    .getState()
    .setSession({
      principal: { kind: "guest", id: "owner" },
      projectId: "demo",
      csrfToken: "csrf",
      expiresAt: "2026-09-13T00:00:00Z",
    });
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response("{}", { headers: { "X-Artisan-Demo-Expires-At": "2026-09-14T00:00:00Z" } }),
    );
  vi.stubGlobal("fetch", fetcher);
  await projectFetch("demo", "/drafts", { method: "POST" });
  expect(new Headers(fetcher.mock.calls[0]![1].headers).get("X-Artisan-Demo-CSRF")).toBe("csrf");
  expect(useDemoStore.getState().session?.expiresAt).toBe("2026-09-14T00:00:00Z");
  await projectFetch("account-project", "/files", { method: "PUT" });
  expect(new Headers(fetcher.mock.calls[1]![1].headers).has("X-Artisan-Demo-CSRF")).toBe(false);
});
