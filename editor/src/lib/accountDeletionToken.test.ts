import { afterEach, expect, test, vi } from "vitest";

afterEach(() => window.history.replaceState(null, "", "/"));

test("removes the email secret from the URL before analytics can see it", async () => {
  vi.resetModules();
  window.history.replaceState(null, "", "/delete-account#token=secret");
  const { accountDeletionToken } = await import("./accountDeletionToken");
  expect(accountDeletionToken).toBe("secret");
  expect(window.location.hash).toBe("");
  expect(window.location.search).toBe("");
});
