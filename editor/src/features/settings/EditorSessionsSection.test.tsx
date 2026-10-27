import { useAuthStore } from "@/state/authStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSessionsSection } from "./EditorSessionsSection";

const api = vi.hoisted(() => ({
  listEditorSessions: vi.fn(),
  revokeEditorSession: vi.fn(),
}));
vi.mock("@/lib/api/editorSessions", () => api);

const session = (over: Record<string, unknown>) => ({
  id: "a".repeat(64),
  playerId: "p1",
  playerName: "Iban",
  permissions: ["artisan.editor.view"],
  serverId: "s1",
  serverLabel: "survie",
  createdAt: "2026-10-20T10:00:00Z",
  lastActiveAt: new Date().toISOString(),
  expiresAt: "2026-11-03T10:00:00Z",
  online: false,
  current: false,
  ...over,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("editor sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists who is signed in, who has the editor open, and closes a session", async () => {
    api.listEditorSessions.mockResolvedValue([
      session({
        id: "me",
        current: true,
        permissions: ["artisan.editor.view", "artisan.editor.config"],
      }),
      session({ id: "steve", playerName: "Steve", online: true }),
    ]);
    api.revokeEditorSession.mockResolvedValue(undefined);
    render(<EditorSessionsSection />);

    expect(await screen.findByText("Steve")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getAllByText("Editor open").length).toBeGreaterThan(0);
    expect(screen.getByText(/View, Configure/)).toBeInTheDocument();
    expect(screen.getAllByText(/from survie/).length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("Steve")).not.toBeInTheDocument());
    expect(api.revokeEditorSession).toHaveBeenCalledWith("steve");
  });

  it("asks before closing one's own session, then signs out", async () => {
    api.listEditorSessions.mockResolvedValue([session({ id: "me", current: true })]);
    api.revokeEditorSession.mockResolvedValue(undefined);
    const sessionClosed = vi.fn();
    useAuthStore.setState({ sessionClosed } as never);
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<EditorSessionsSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(api.revokeEditorSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(sessionClosed).toHaveBeenCalled());
    expect(api.revokeEditorSession).toHaveBeenCalledWith("me");
    confirm.mockRestore();
  });
});
