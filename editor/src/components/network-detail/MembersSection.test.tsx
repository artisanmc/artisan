import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MembersSection } from "./MembersSection";
import * as membersApi from "@/lib/api/members";
import { useAuthStore } from "@/state/authStore";

function setCurrentUser(id: string) {
  useAuthStore.setState({
    currentUser: { id, email: "me@test.com", name: "Me", avatarUrl: null },
    isLoading: false,
    error: null,
  });
}

const owners = [
  { userId: "u1", email: "owner@test.com", displayName: "Owner", role: "owner" as const, createdAt: "2026-01-01T00:00:00Z" },
  { userId: "u2", email: "member@test.com", displayName: "Member", role: "member" as const, createdAt: "2026-01-02T00:00:00Z" },
];

describe("MembersSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setCurrentUser("u1");
  });

  it("renders the member list with role badges", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("owner@test.com");
    expect(screen.getByText("member@test.com")).toBeInTheDocument();
  });

  it("hides management actions for a member-role viewer", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    setCurrentUser("u2"); // logged-in user is the plain member
    render(<MembersSection networkId="n1" />);
    await screen.findByText("owner@test.com");
    expect(screen.queryByRole("button", { name: /promote|demote|promouvoir|rétrograder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove|retirer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite|inviter/i })).not.toBeInTheDocument();
  });

  it("disables demote/remove on the last remaining owner", async () => {
    const soleOwner = owners.find((m) => m.role === "owner")!;
    vi.spyOn(membersApi, "listMembers").mockResolvedValue([soleOwner]); // only manager
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("owner@test.com");
    const demoteBtn = screen.getByRole("button", { name: /demote|rétrograder/i });
    const removeBtn = screen.getByRole("button", { name: /remove|retirer/i });
    expect(demoteBtn).toBeDisabled();
    expect(removeBtn).toBeDisabled();
  });

  it("creates an invite and shows the copyable link", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    const createSpy = vi.spyOn(membersApi, "createInvite").mockResolvedValue({
      id: "inv1",
      code: "abc123",
      url: "http://localhost:5173/invite?code=abc123",
      email: null,
      maxUses: null,
      usedCount: 0,
      expiresAt: "2026-08-01T00:00:00Z",
    });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<MembersSection networkId="n1" />);
    await screen.findByText("owner@test.com");
    fireEvent.click(screen.getByRole("button", { name: /invite|inviter/i }));
    fireEvent.click(screen.getByRole("button", { name: /send invite|envoyer l.invitation/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    await screen.findByText("http://localhost:5173/invite?code=abc123");
    fireEvent.click(screen.getByRole("button", { name: /copy|copier/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost:5173/invite?code=abc123"));
  });

  it("revokes an invite", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([
      {
        id: "inv1",
        code: "abc123",
        url: "http://localhost:5173/invite?code=abc123",
        email: "friend@test.com",
        maxUses: 5,
        usedCount: 1,
        expiresAt: "2026-08-01T00:00:00Z",
      },
    ]);
    const revokeSpy = vi.spyOn(membersApi, "revokeInvite").mockResolvedValue(undefined);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("friend@test.com");
    fireEvent.click(screen.getByRole("button", { name: /revoke|révoquer/i }));
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith("n1", "inv1"));
  });
});
