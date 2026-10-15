import { ApiError, apiFetch, apiRequest } from "./client";

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
  email?: string;
  name: string;
  avatarUrl?: string | null;
  editorLanguage?: string | null;
  theme?: "dark" | "light" | null;
  editorTour?: EditorTourProgress | null;
}

export async function logout(): Promise<void> {
  await apiRequest("/api/v1/auth/logout", { method: "POST" });
}

/**
 * The session's user, or null for an anonymous one (401). Anything else
 * rejects with an `ApiError`: the hub did not answer, or answered something
 * that says NOTHING about the session — least of all that it ended.
 */
export async function getMe(): Promise<AuthUserDto | null> {
  try {
    const data = await apiFetch<{ user?: AuthUserDto }>("/api/v1/auth/me");
    // A 200 without a user (a proxy's page, a truncated body) is an
    // unreachable hub, not a sign-out.
    if (!data?.user) throw new ApiError("auth_unreachable", 200);
    return data.user;
  } catch (error) {
    const failure = ApiError.from(error);
    if (failure.status === 401) return null;
    throw failure;
  }
}

export async function patchMe(payload: {
  editor_language?: string | null;
  theme?: "dark" | "light" | null;
  editor_tour?: EditorTourAction;
}): Promise<{ user: AuthUserDto; tourStarted?: boolean } | { error: string }> {
  try {
    return await apiFetch("/api/v1/auth/me", { method: "PATCH", json: payload });
  } catch (error) {
    return { error: `patch_me_failed_${ApiError.from(error).status}` };
  }
}
