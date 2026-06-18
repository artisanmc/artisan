const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ActiveModule {
  id: string;
  version: string | null;
}

/**
 * Active modules for the current plugin session (presence activation). Source:
 * server_modules, populated at each plugin `hello`. Session-mode only — the
 * endpoint authenticates via the editor-session access token in the path.
 * Returns [] on any non-OK response (treat "no presence info" as "no modules").
 */
export async function fetchActiveModules(accessToken: string): Promise<ActiveModule[]> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${accessToken}/modules`);
  if (!res.ok) return [];
  const data = (await res.json()) as { modules?: ActiveModule[] };
  return data.modules ?? [];
}
