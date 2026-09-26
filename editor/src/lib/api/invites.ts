const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type InviteStatus = "valid" | "revoked" | "expired" | "exhausted";

export interface InvitePreview {
  status: InviteStatus;
  networkName: string | null;
  role: string;
}

export type InvitePreviewResult = InvitePreview | "not_found";

/** GET /api/v1/invites/:code — public, no credentials needed. */
export async function fetchInvitePreview(code: string): Promise<InvitePreviewResult> {
  const res = await fetch(`${API_URL}/api/v1/invites/${code}`);
  if (res.status === 404) return "not_found";
  if (!res.ok) throw new Error(`fetchInvitePreview failed: ${res.status}`);
  const body = (await res.json()) as { status: InviteStatus; network_name: string | null; role: string };
  return { status: body.status, networkName: body.network_name, role: body.role };
}

export class AcceptInviteError extends Error {
  constructor(
    public readonly code: "revoked" | "expired" | "exhausted" | "not_found" | "unauthorized" | "collaborator_limit_reached" | "unknown",
  ) {
    super(code);
  }
}

/** POST /api/v1/invites/:code/accept — requires the user session cookie. */
export async function acceptInvite(
  code: string,
): Promise<{ networkId: string; alreadyMember: boolean }> {
  const res = await fetch(`${API_URL}/api/v1/invites/${code}/accept`, {
    method: "POST",
    credentials: "include",
  });
  if (res.ok) {
    const body = (await res.json()) as { network_id: string; already_member: boolean };
    return { networkId: body.network_id, alreadyMember: body.already_member };
  }
  if (res.status === 401) throw new AcceptInviteError("unauthorized");
  if (res.status === 404) throw new AcceptInviteError("not_found");
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "collaborator_limit_reached") throw new AcceptInviteError("collaborator_limit_reached");
  }
  if (res.status === 410) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "revoked" || body.error === "expired" || body.error === "exhausted") {
      throw new AcceptInviteError(body.error);
    }
    throw new AcceptInviteError("unknown");
  }
  throw new AcceptInviteError("unknown");
}
