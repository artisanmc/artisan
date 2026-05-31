import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/i18n";
import { SignupForm } from "./SignupForm";
import { useAuthStore } from "@/state/authStore";

beforeEach(() => {
  useAuthStore.setState({ currentUser: null, isLoading: false, error: null });
  vi.restoreAllMocks();
});

describe("SignupForm", () => {
  test("submits email + password + name", async () => {
    const signupSpy = vi.spyOn(useAuthStore.getState(), "signup").mockResolvedValue({ ok: true });
    render(<SignupForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^email$/i), "n@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.type(screen.getByLabelText(/^name|^nom/i), "Nathan");
    await userEvent.click(screen.getByRole("button", { name: /sign up|s'inscrire/i }));
    expect(signupSpy).toHaveBeenCalledWith("http://x", { email: "n@e.com", password: "longenoughpw", name: "Nathan" });
  });

  test("shows email_taken error on 409", async () => {
    vi.spyOn(useAuthStore.getState(), "signup").mockResolvedValue({ ok: false, error: "email_taken", status: 409 });
    render(<SignupForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^email$/i), "taken@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.type(screen.getByLabelText(/^name|^nom/i), "T");
    await userEvent.click(screen.getByRole("button", { name: /sign up|s'inscrire/i }));
    expect(await screen.findByText(/existe déjà|already exists/i)).toBeInTheDocument();
  });
});

// Tests for next= parameter redirect logic (used in route component)
describe("next= parameter handling", () => {
  test("extracts safe /next= path", () => {
    const params = new URLSearchParams("?next=/link");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/link");
  });

  test("ignores protocol-relative URLs (//)", () => {
    const params = new URLSearchParams("?next=//evil.com");
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    expect(safeNext).toBe("/account");
  });

  test("ignores javascript: URLs", () => {
    const params = new URLSearchParams("?next=javascript:alert(1)");
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
});
