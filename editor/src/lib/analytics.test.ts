import { beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: sdk }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

it("does not initialize or capture analytics without a project token", async () => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "  ");
  const analytics = await import("./analytics");
  analytics.capturePageView("https://example.test/");
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.capture).not.toHaveBeenCalled();
});

it("initializes and tracks page views when a token is configured", async () => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "project-token");
  const analytics = await import("./analytics");
  analytics.capturePageView("https://example.test/");
  expect(sdk.init).toHaveBeenCalledWith("project-token", expect.any(Object));
  expect(sdk.capture).toHaveBeenCalledWith("$pageview", { $current_url: "https://example.test/" });
});
