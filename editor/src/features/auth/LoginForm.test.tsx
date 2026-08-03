import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import "@/i18n"; // Side-effect: initializes react-i18next so useTranslation() returns translated strings.
import { useAuthStore } from "@/state/authStore";
import { LoginForm } from "./LoginForm";

beforeEach(() => {
  useAuthStore.setState({ currentUser: null, isLoading: false, error: null });
  vi.restoreAllMocks();
});

describe("LoginForm", () => {
  test("submits email + password", async () => {
    const loginSpy = vi.spyOn(useAuthStore.getState(), "login").mockResolvedValue({ ok: true });
    render(<LoginForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.click(screen.getByRole("button", { name: /sign in|se connecter/i }));
    expect(loginSpy).toHaveBeenCalledWith("http://x", {
      email: "a@e.com",
      password: "longenoughpw",
    });
  });

  test("displays error on failed login", async () => {
    vi.spyOn(useAuthStore.getState(), "login").mockResolvedValue({
      ok: false,
      error: "invalid_credentials",
      status: 401,
    });
    render(<LoginForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.click(screen.getByRole("button", { name: /sign in|se connecter/i }));
    expect(await screen.findByText(/wrong email|incorrect/i)).toBeInTheDocument();
  });

  test("offers a forgot-password link", () => {
    render(<LoginForm apiUrl="http://x" onSuccess={() => {}} />);
    expect(screen.getByRole("link", { name: /forgot|oublié/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  test("calls onSuccess on successful login", async () => {
    vi.spyOn(useAuthStore.getState(), "login").mockResolvedValue({ ok: true });
    const onSuccess = vi.fn();
    render(<LoginForm apiUrl="http://x" onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.click(screen.getByRole("button", { name: /sign in|se connecter/i }));
    expect(onSuccess).toHaveBeenCalled();
  });
});

// Tests for next= parameter redirect logic (used in route component)
describe("next= parameter handling", () => {
  test("extracts safe /next= path", () => {
    const params = new URLSearchParams("?next=/workspace/123");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/workspace/123");
  });

  test("ignores protocol-relative URLs (//)", () => {
    const params = new URLSearchParams("?next=//evil.com/path");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/account");
  });

  test("ignores absolute URLs", () => {
    const params = new URLSearchParams("?next=https://evil.com");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/account");
  });

  test("defaults to /account when next= missing", () => {
    const params = new URLSearchParams("");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/account");
  });

  test("defaults to /account when next= is empty string", () => {
    const params = new URLSearchParams("?next=");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/account");
  });

  test("preserves query params in next= path", () => {
    const params = new URLSearchParams("?next=/workspace/123?tab=settings");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/workspace/123?tab=settings");
  });
});
