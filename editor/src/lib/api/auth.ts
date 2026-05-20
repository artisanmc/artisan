export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface ApiOptions {
  apiUrl: string;
}

async function postJson<T>(
  url: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return { ok: true, data: undefined as unknown as T };
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: data as T };
  return { ok: false, status: res.status, error: (data as { error?: string }).error ?? "unknown" };
}

export async function signup(
  { apiUrl }: ApiOptions,
  payload: { email: string; password: string; name: string },
) {
  return postJson<{ user: AuthUserDto }>(`${apiUrl}/api/auth/signup`, payload);
}

export async function login(
  { apiUrl }: ApiOptions,
  payload: { email: string; password: string },
) {
  return postJson<{ user: AuthUserDto }>(`${apiUrl}/api/auth/login`, payload);
}

export async function logout({ apiUrl }: ApiOptions) {
  await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" });
}

export async function getMe({ apiUrl }: ApiOptions): Promise<AuthUserDto | null> {
  const res = await fetch(`${apiUrl}/api/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as { user: AuthUserDto };
  return data.user;
}
