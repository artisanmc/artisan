import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import "@/i18n";
import * as authApi from "@/lib/api/auth";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ForgotPasswordForm", () => {
  test("posts the email and shows the neutral confirmation", async () => {
    const spy = vi
      .spyOn(authApi, "forgotPassword")
      .mockResolvedValue({ ok: true, data: undefined as never });
    render(<ForgotPasswordForm apiUrl="http://x" />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.click(screen.getByRole("button", { name: /send|envoyer/i }));

    expect(spy).toHaveBeenCalledWith({ apiUrl: "http://x" }, { email: "a@e.com" });
    expect(await screen.findByText(/a@e\.com/)).toBeInTheDocument();
    // The form is gone — no way to tell from the UI whether the account exists.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  test("shows the same confirmation for an unknown email", async () => {
    vi.spyOn(authApi, "forgotPassword").mockResolvedValue({ ok: true, data: undefined as never });
    render(<ForgotPasswordForm apiUrl="http://x" />);
    await userEvent.type(screen.getByLabelText(/email/i), "ghost@e.com");
    await userEvent.click(screen.getByRole("button", { name: /send|envoyer/i }));
    expect(await screen.findByText(/ghost@e\.com/)).toBeInTheDocument();
  });

  test("surfaces a network failure and keeps the form", async () => {
    vi.spyOn(authApi, "forgotPassword").mockRejectedValue(new Error("offline"));
    render(<ForgotPasswordForm apiUrl="http://x" />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.click(screen.getByRole("button", { name: /send|envoyer/i }));
    expect(await screen.findByText(/reach the server|joindre le serveur/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  test("links back to sign in", () => {
    render(<ForgotPasswordForm apiUrl="http://x" />);
    expect(screen.getByRole("link", { name: /sign in|connexion/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
