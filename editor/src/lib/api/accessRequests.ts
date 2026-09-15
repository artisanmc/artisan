const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type AccessRequestStatus = "pending" | "approved" | "denied";

export interface AccessOptions {
  mode: "invitation" | "console";
  isMember: boolean;
  command: string | null;
  servers: { id: string; label: string | null; online: boolean }[];
}

export async function getAccessOptions(
  networkIdOrSlug: string,
  signal?: AbortSignal,
): Promise<AccessOptions> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${encodeURIComponent(networkIdOrSlug)}/access-options`,
    {
      credentials: "include",
      signal,
    },
  );
  if (!res.ok) throw apiError("getAccessOptions", res.status, await res.json().catch(() => ({})));
  return res.json();
}

export interface AccessRequest {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  message: string | null;
  status: AccessRequestStatus;
  createdAt: string;
}

function apiError(
  prefix: string,
  status: number,
  body: { error?: string },
): Error & {
  status: number;
} {
  const err = new Error(body.error ?? `${prefix} failed: ${status}`) as Error & {
    status: number;
  };
  err.status = status;
  return err;
}

/** POST /api/v1/networks/:idOrSlug/access-requests — body { message? }. 409 already_member|already_pending. */
export async function requestAccess(networkIdOrSlug: string, message?: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkIdOrSlug}/access-requests`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw apiError("requestAccess", res.status, body);
  }
}

/** GET /api/v1/networks/:id/access-requests — managers only. */
export async function listAccessRequests(networkId: string): Promise<AccessRequest[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/access-requests`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw apiError("listAccessRequests", res.status, body);
  }
  return ((await res.json()) as { requests: AccessRequest[] }).requests;
}

/** POST /api/v1/networks/:id/access-requests/:requestId/approve — managers only. */
export async function approveAccessRequest(networkId: string, requestId: string): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/access-requests/${requestId}/approve`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw apiError("approveAccessRequest", res.status, body);
  }
}

/** POST /api/v1/networks/:id/access-requests/:requestId/deny — managers only. */
export async function denyAccessRequest(networkId: string, requestId: string): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/access-requests/${requestId}/deny`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw apiError("denyAccessRequest", res.status, body);
  }
}
