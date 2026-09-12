import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import "@/i18n";
import * as api from "@/lib/api/auth";
import { DeleteAccountConfirmation, DeleteAccountSection } from "./DeleteAccount";

beforeEach(() => vi.restoreAllMocks());

test("profile asks for confirmation before requesting an email", async () => {
  const send = vi
    .spyOn(api, "requestAccountDeletion")
    .mockResolvedValue({ ok: true, data: undefined });
  render(<DeleteAccountSection apiUrl="http://x" email="alice@example.com" />);
  await userEvent.click(
    screen.getByRole("button", { name: /delete my account|supprimer mon compte/i }),
  );
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent(/Minecraft/);
  await userEvent.click(screen.getByRole("button", { name: /send.*email|envoyer.*email/i }));
  expect(send).toHaveBeenCalledWith({ apiUrl: "http://x" });
  expect(await screen.findByRole("status")).toHaveTextContent(/alice@example.com/);
});

test("opening a confirmation page never deletes automatically", async () => {
  const remove = vi.spyOn(api, "deleteAccount").mockResolvedValue({ ok: true, data: undefined });
  render(<DeleteAccountConfirmation apiUrl="http://x" token="secret" />);
  expect(remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /permanently|définitivement/i }));
  expect(remove).toHaveBeenCalledWith({ apiUrl: "http://x" }, { token: "secret" });
  expect(await screen.findByRole("status")).toHaveTextContent(/deleted|supprimé/i);
});

test("invalid link offers a way back to the profile", async () => {
  vi.spyOn(api, "deleteAccount").mockResolvedValue({
    ok: false,
    status: 400,
    error: "invalid_token",
  });
  render(<DeleteAccountConfirmation apiUrl="http://x" token="expired" />);
  await userEvent.click(screen.getByRole("button", { name: /permanently|définitivement/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/expired|expiré/i);
  expect(screen.getByRole("link", { name: /back to profile|retour au profil/i })).toHaveAttribute(
    "href",
    "/account",
  );
});

test("a missing token cannot be submitted", () => {
  render(<DeleteAccountConfirmation apiUrl="http://x" token="" />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
