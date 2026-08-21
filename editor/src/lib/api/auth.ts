export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  editorLanguage?: string | null;
  theme?: "dark" | "light" | null;
  isAdmin?: boolean;
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
  return postJson<{ user: AuthUserDto }>(`${apiUrl}/api/v1/auth/signup`, payload);
}

export async function login({ apiUrl }: ApiOptions, payload: { email: string; password: string }) {
  return postJson<{ user: AuthUserDto }>(`${apiUrl}/api/v1/auth/login`, payload);
}

export async function forgotPassword({ apiUrl }: ApiOptions, payload: { email: string }) {
  return postJson<void>(`${apiUrl}/api/v1/auth/forgot-password`, payload);
}

export async function resetPassword(
  { apiUrl }: ApiOptions,
  payload: { token: string; password: string },
) {
  return postJson<void>(`${apiUrl}/api/v1/auth/reset-password`, payload);
}

export async function logout({ apiUrl }: ApiOptions) {
  await fetch(`${apiUrl}/api/v1/auth/logout`, { method: "POST", credentials: "include" });
}

/** Le backend n'a pas répondu — on ne sait RIEN de la session, surtout pas
 *  qu'elle est finie. À distinguer d'un 401, qui lui dit « anonyme ». */
export class AuthUnreachableError extends Error {
  constructor(readonly status?: number) {
    super(`auth_unreachable${status ? `_${status}` : ""}`);
    this.name = "AuthUnreachableError";
  }
}

export async function getMe({ apiUrl }: ApiOptions): Promise<AuthUserDto | null> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/auth/me`, { credentials: "include" });
  } catch {
    throw new AuthUnreachableError();
  }
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthUnreachableError(res.status);
  // Un 200 au corps illisible (page d'erreur d'un proxy, réponse tronquée) ne
  // dit rien non plus : c'est un backend injoignable, pas une panne fatale.
  let data: { user?: AuthUserDto } | null;
  try {
    data = (await res.json()) as { user?: AuthUserDto };
  } catch {
    throw new AuthUnreachableError(res.status);
  }
  if (!data?.user) throw new AuthUnreachableError(res.status);
  return data.user;
}

export async function patchMe(
  { apiUrl }: ApiOptions,
  payload: { editor_language?: string | null; theme?: "dark" | "light" | null },
): Promise<{ user: AuthUserDto } | { error: string }> {
  const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { error: `patch_me_failed_${res.status}` };
  return res.json();
}
