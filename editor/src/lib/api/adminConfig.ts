const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export interface AssistantConfigDto {
  provider: string;
  baseUrl: string;
  model: string;
  keySet: boolean;
}

export async function getAssistantConfig(): Promise<AssistantConfigDto | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/assistant-config`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return (await res.json()) as AssistantConfigDto;
}

export async function putAssistantConfig(body: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<{ ok: true; data: AssistantConfigDto } | { ok: false; status: number }> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/assistant-config`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as AssistantConfigDto };
}

export async function testAssistantConfig(body: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/assistant-config/test`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  return (await res.json()) as { ok: boolean; error?: string };
}
