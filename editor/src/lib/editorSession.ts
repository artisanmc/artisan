const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface EditorSessionInfo {
  server_key_id: string;
}

export async function validateEditorSession(token: string): Promise<EditorSessionInfo> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}`);
  if (!res.ok) throw new Error("Session invalide ou expirée");
  return res.json() as Promise<EditorSessionInfo>;
}

export async function refreshEditorSession(token: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${token}/refresh`, { method: "POST" });
}

export async function revokeEditorSession(token: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${token}`, { method: "DELETE" });
}

export async function saveDraft(
  token: string,
  packId: string,
  menuId: string,
  menuYaml: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId, menu_id: menuId, menu_yaml: menuYaml }),
  });
  if (!res.ok) throw new Error("Échec de la sauvegarde du draft");
}
