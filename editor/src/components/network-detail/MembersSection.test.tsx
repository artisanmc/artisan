import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MembersSection } from "./MembersSection";
import * as membersApi from "@/lib/api/members";
import * as accessRequestsApi from "@/lib/api/accessRequests";
import { useAuthStore } from "@/state/authStore";

function setCurrentUser(id: string) {
  useAuthStore.setState({
    currentUser: { id, email: "me@test.com", name: "Me", avatarUrl: null },
    isLoading: false,
    error: null,
  });
}

/**
 * Invite expiry always goes through these two: the component filters expired
 * invites out, so a "live" fixture dated a few weeks ahead turns into an
 * invisible one the day it passes — silently, and in CI only. That is exactly
 * how this spec broke on 2026-08-01.
 */
const NOT_EXPIRED = "2099-01-01T00:00:00Z";
const EXPIRED = "2020-01-01T00:00:00Z";

const owners = [
  { userId: "u1", email: "owner@test.com", displayName: "Owner", role: "owner" as const, createdAt: "2026-01-01T00:00:00Z" },
  { userId: "u2", email: "member@test.com", displayName: "Member", role: "member" as const, createdAt: "2026-01-02T00:00:00Z" },
];

describe("MembersSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setCurrentUser("u1");
    vi.spyOn(accessRequestsApi, "listAccessRequests").mockResolvedValue([]);
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

  it("member viewer sees the roster read-only and no invites block (doesn't call listInvites)", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    const invitesSpy = vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    setCurrentUser("u2"); // logged-in user is the plain member
    render(<MembersSection networkId="n1" />);
    await screen.findByText("owner@test.com");
    expect(screen.getByText("member@test.com")).toBeInTheDocument();
    expect(screen.queryByText(/pending invites|invitations en attente/i)).not.toBeInTheDocument();
    expect(invitesSpy).not.toHaveBeenCalled();
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
      expiresAt: NOT_EXPIRED,
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

  it("only renders valid invites — revoked and expired are filtered out", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([
      {
        id: "inv-revoked",
        code: "revoked1",
        url: "http://localhost:5173/invite?code=revoked1",
        email: "revoked@test.com",
        maxUses: null,
        usedCount: 0,
        expiresAt: NOT_EXPIRED,
        revokedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "inv-expired",
        code: "expired1",
        url: "http://localhost:5173/invite?code=expired1",
        email: "expired@test.com",
        maxUses: null,
        usedCount: 0,
        expiresAt: EXPIRED,
      },
      {
        id: "inv-valid",
        code: "valid1",
        url: "http://localhost:5173/invite?code=valid1",
        email: "valid@test.com",
        maxUses: null,
        usedCount: 0,
        expiresAt: NOT_EXPIRED,
      },
    ]);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("valid@test.com");
    expect(screen.queryByText("revoked@test.com")).not.toBeInTheDocument();
    expect(screen.queryByText("expired@test.com")).not.toBeInTheDocument();
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
        expiresAt: NOT_EXPIRED,
      },
    ]);
    const revokeSpy = vi.spyOn(membersApi, "revokeInvite").mockResolvedValue(undefined);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("friend@test.com");
    fireEvent.click(screen.getByRole("button", { name: /revoke|révoquer/i }));
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith("n1", "inv1"));
  });

  it("shows pending access requests to a manager, with message and approve/deny buttons", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    vi.spyOn(accessRequestsApi, "listAccessRequests").mockResolvedValue([
      {
        id: "req1",
        userId: "u3",
        email: "newbie@test.com",
        displayName: "Newbie",
        message: "Please let me in",
        status: "pending",
        createdAt: "2026-07-01T00:00:00Z",
      },
    ]);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("owner@test.com");
    await screen.findByText("newbie@test.com");
    expect(screen.getByText("Please let me in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve|approuver/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny|refuser/i })).toBeInTheDocument();
  });

  it("does not call listAccessRequests for a plain member", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    const reqSpy = vi.spyOn(accessRequestsApi, "listAccessRequests").mockResolvedValue([]);
    setCurrentUser("u2"); // plain member
    render(<MembersSection networkId="n1" />);
    await screen.findByText("owner@test.com");
    expect(reqSpy).not.toHaveBeenCalled();
  });

  it("approves an access request and adds the member to the roster locally", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    vi.spyOn(accessRequestsApi, "listAccessRequests").mockResolvedValue([
      {
        id: "req1",
        userId: "u3",
        email: "newbie@test.com",
        displayName: "Newbie",
        message: null,
        status: "pending",
        createdAt: "2026-07-01T00:00:00Z",
      },
    ]);
    const approveSpy = vi.spyOn(accessRequestsApi, "approveAccessRequest").mockResolvedValue(undefined);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("newbie@test.com");
    fireEvent.click(screen.getByRole("button", { name: /approve|approuver/i }));
    await waitFor(() => expect(approveSpy).toHaveBeenCalledWith("n1", "req1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /approve|approuver/i })).not.toBeInTheDocument());
    expect(screen.getAllByText("newbie@test.com").length).toBeGreaterThan(0);
  });

  it("denies an access request and removes it from the list", async () => {
    vi.spyOn(membersApi, "listMembers").mockResolvedValue(owners);
    vi.spyOn(membersApi, "listInvites").mockResolvedValue([]);
    vi.spyOn(accessRequestsApi, "listAccessRequests").mockResolvedValue([
      {
        id: "req1",
        userId: "u3",
        email: "newbie@test.com",
        displayName: "Newbie",
        message: null,
        status: "pending",
        createdAt: "2026-07-01T00:00:00Z",
      },
    ]);
    const denySpy = vi.spyOn(accessRequestsApi, "denyAccessRequest").mockResolvedValue(undefined);
    render(<MembersSection networkId="n1" />);
    await screen.findByText("newbie@test.com");
    fireEvent.click(screen.getByRole("button", { name: /deny|refuser/i }));
    await waitFor(() => expect(denySpy).toHaveBeenCalledWith("n1", "req1"));
    await waitFor(() => expect(screen.queryByText("newbie@test.com")).not.toBeInTheDocument());
  });
});
