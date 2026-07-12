const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type MemberRole = "owner" | "admin" | "member";

export interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  role: MemberRole;
  createdAt: string;
}

export interface Invite {
  id: string;
  code: string;
  url: string;
  email: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string;
  revokedAt?: string | null;
}

/** GET /api/v1/networks/:id/members — owner/admin only (403 for plain members). */
export async function listMembers(networkId: string): Promise<Member[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/members`, {
    credentials: "include",
  });
  if (!res.ok) {
    const err = new Error(`listMembers failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return ((await res.json()) as { members: Member[] }).members;
}

/** DELETE /api/v1/networks/:id/members/:userId — 409 "last_owner" if it's the sole manager. */
export async function removeMember(networkId: string, userId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/members/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(body.error ?? `removeMember failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
}

/** PATCH /api/v1/networks/:id/members/:userId — body { role }. 409 "last_owner" guard. */
export async function updateMemberRole(
  networkId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/members/${userId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(body.error ?? `updateMemberRole failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
}

/** POST /api/v1/networks/:id/invites — email optional. Returns the generated link. */
export async function createInvite(networkId: string, email?: string): Promise<Invite> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/invites`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email ? { email } : {}),
  });
  if (!res.ok) throw new Error(`createInvite failed: ${res.status}`);
  return ((await res.json()) as { invite: Invite }).invite;
}

/** GET /api/v1/networks/:id/invites — pending + past invites for this network. */
export async function listInvites(networkId: string): Promise<Invite[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/invites`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`listInvites failed: ${res.status}`);
  return ((await res.json()) as { invites: Invite[] }).invites;
}

/** DELETE /api/v1/networks/:id/invites/:inviteId — revoke a pending invite. */
export async function revokeInvite(networkId: string, inviteId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/invites/${inviteId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`revokeInvite failed: ${res.status}`);
}
