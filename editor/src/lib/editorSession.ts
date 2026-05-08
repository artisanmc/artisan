const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface EditorSessionInfo {
  server_key_id: string;
  trusted: boolean;
  trust_code: string;
}

export interface ExchangeResult {
  access_token: string;
  expires_in: number;
  trust_code: string;
}

export async function exchangeEditorSession(urlToken: string): Promise<ExchangeResult> {
  const res = await fetch(`${API_URL}/api/editor-session/${urlToken}/exchange`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error === "already_used" ? "already_used" : "Session invalide ou expirée");
  }
  return res.json() as Promise<ExchangeResult>;
}

export async function refreshEditorSession(): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/editor-session/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = await res.json() as { access_token: string };
  return body.access_token;
}

export async function validateEditorSession(accessToken: string): Promise<EditorSessionInfo> {
  const res = await fetch(`${API_URL}/api/editor-session/${accessToken}`, { credentials: "include" });
  if (!res.ok) throw new Error("Session invalide ou expirée");
  return res.json() as Promise<EditorSessionInfo>;
}

export async function revokeEditorSession(accessToken: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${accessToken}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function saveDraft(
  accessToken: string,
  packId: string,
  menuId: string,
  menuYaml: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/editor-session/${accessToken}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId, menu_id: menuId, menu_yaml: menuYaml }),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Échec de la sauvegarde du draft");
}
