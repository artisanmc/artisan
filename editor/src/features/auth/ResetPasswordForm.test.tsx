import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import "@/i18n";
import * as authApi from "@/lib/api/auth";
import { ResetPasswordForm } from "./ResetPasswordForm";

beforeEach(() => {
  vi.restoreAllMocks();
});

function fields() {
  return {
    password: screen.getByLabelText(/new password|nouveau mot de passe/i),
    confirm: screen.getByLabelText(/confirm/i),
    submit: screen.getByRole("button", { name: /update|mettre à jour/i }),
  };
}

describe("ResetPasswordForm", () => {
  test("posts token + password and shows the success screen", async () => {
    const spy = vi
      .spyOn(authApi, "resetPassword")
      .mockResolvedValue({ ok: true, data: undefined as never });
    render(<ResetPasswordForm apiUrl="http://x" token="tok123" />);
    const f = fields();
    await userEvent.type(f.password, "brandnewpw123");
    await userEvent.type(f.confirm, "brandnewpw123");
    await userEvent.click(f.submit);

    expect(spy).toHaveBeenCalledWith(
      { apiUrl: "http://x" },
      { token: "tok123", password: "brandnewpw123" },
    );
    expect(
      await screen.findByText(/password updated|mot de passe mis à jour/i),
    ).toBeInTheDocument();
  });

  test("refuses mismatched passwords without calling the API", async () => {
    const spy = vi.spyOn(authApi, "resetPassword");
    render(<ResetPasswordForm apiUrl="http://x" token="tok123" />);
    const f = fields();
    await userEvent.type(f.password, "brandnewpw123");
    await userEvent.type(f.confirm, "somethingelse123");
    await userEvent.click(f.submit);

    expect(spy).not.toHaveBeenCalled();
    expect(await screen.findByText(/don't match|ne correspondent pas/i)).toBeInTheDocument();
  });

  test("shows the invalid-token error returned by the API", async () => {
    vi.spyOn(authApi, "resetPassword").mockResolvedValue({
      ok: false,
      status: 400,
      error: "invalid_token",
    });
    render(<ResetPasswordForm apiUrl="http://x" token="stale" />);
    const f = fields();
    await userEvent.type(f.password, "brandnewpw123");
    await userEvent.type(f.confirm, "brandnewpw123");
    await userEvent.click(f.submit);
    expect(
      await screen.findByText(/invalid or has expired|invalide ou expiré/i),
    ).toBeInTheDocument();
  });

  test("reports a missing token instead of rendering the form", () => {
    render(<ResetPasswordForm apiUrl="http://x" token="" />);
    expect(screen.getByText(/incomplete|incomplet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm/i)).not.toBeInTheDocument();
  });
});
