import "@/i18n";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

test.each([LoginForm, SignupForm])(
  "preserves the requested project through Google login",
  async (Form) => {
    const next = "/networks/network/servers/server/projects/project?tab=menus#details";
    window.history.replaceState({}, "", `/login?${new URLSearchParams({ next })}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ configured: true })),
    );
    render(<Form apiUrl="http://api" onSuccess={() => {}} />);
    const link = await screen.findByRole("link", { name: /Google/i });
    expect(new URL(link.getAttribute("href")!).searchParams.get("next")).toBe(next);
  },
);

test.each([LoginForm, SignupForm])(
  "offers Google on the auth form when configured",
  async (Form) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => Response.json({ configured: url.includes("/google/") })),
    );
    render(<Form apiUrl="http://api" onSuccess={() => {}} />);
    expect(await screen.findByRole("link", { name: /Google/i })).toHaveAttribute(
      "href",
      "http://api/api/v1/auth/google/start",
    );
  },
);

test("hides Google when not configured", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ configured: false })),
  );
  render(<LoginForm apiUrl="http://api" onSuccess={() => {}} />);
  expect(screen.queryByRole("link", { name: /Google/i })).not.toBeInTheDocument();
});

test("shows a useful error when Google consent was cancelled", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ configured: false })),
  );
  window.history.replaceState({}, "", "/login?oauth_error=oauth_cancelled");
  try {
    render(<LoginForm apiUrl="http://api" onSuccess={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/cancel|annul/i);
  } finally {
    window.history.replaceState({}, "", "/");
  }
});
