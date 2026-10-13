export interface EditorTourProgress {
  step: number;
  completed: boolean;
}

export type EditorTourAction =
  | { action: "start" }
  | { action: "progress"; step: number }
  | { action: "complete" }
  | { action: "import"; step: number; completed: boolean };

export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  editorLanguage?: string | null;
  theme?: "dark" | "light" | null;
  isAdmin?: boolean;
  editorTour?: EditorTourProgress | null;
}

export interface ApiOptions {
  apiUrl: string;
}

export async function logout({ apiUrl }: ApiOptions) {
  await fetch(`${apiUrl}/api/v1/auth/logout`, { method: "POST", credentials: "include" });
}

/** The hub did not answer — we know NOTHING about the session, least of all
 *  that it ended. Distinct from a 401, which does say "anonymous". */
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
  // A 200 with an unreadable body (a proxy's error page, a truncated response)
  // says nothing either: it is an unreachable hub, not a fatal failure.
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
  payload: {
    editor_language?: string | null;
    theme?: "dark" | "light" | null;
    editor_tour?: EditorTourAction;
  },
): Promise<{ user: AuthUserDto; tourStarted?: boolean } | { error: string }> {
  const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { error: `patch_me_failed_${res.status}` };
  return res.json();
}
