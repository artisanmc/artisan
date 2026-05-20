import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/i18n"; // Side-effect: initializes react-i18next so useTranslation() returns translated strings.
import { LoginForm } from "./LoginForm";
import { useAuthStore } from "@/state/authStore";

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
    expect(loginSpy).toHaveBeenCalledWith("http://x", { email: "a@e.com", password: "longenoughpw" });
  });

  test("displays error on failed login", async () => {
    vi.spyOn(useAuthStore.getState(), "login").mockResolvedValue({ ok: false, error: "invalid_credentials", status: 401 });
    render(<LoginForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.click(screen.getByRole("button", { name: /sign in|se connecter/i }));
    expect(await screen.findByText(/wrong email|incorrect/i)).toBeInTheDocument();
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
