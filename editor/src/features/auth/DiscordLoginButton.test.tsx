import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DiscordLoginButton } from "./DiscordLoginButton";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
test("preserves a selected pricing plan through Discord login", async () => {
  const next = "/pricing?plan=pro";
  window.history.replaceState({}, "", `/signup?${new URLSearchParams({ next })}`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ configured: true })),
  );
  render(<DiscordLoginButton apiUrl="http://api" />);
  const link = await screen.findByRole("link", { name: /Discord/i });
  expect(new URL(link.getAttribute("href")!).searchParams.get("next")).toBe(next);
});
