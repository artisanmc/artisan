const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Editable `config.yml` of a server, flat dotted keys (ADR `server-config-from-editor`). */
export type ServerConfig = Record<string, unknown>;

const url = (networkId: string, serverKeyId: string) =>
  `${API_URL}/api/v1/networks/${encodeURIComponent(networkId)}/servers/${encodeURIComponent(serverKeyId)}/server-config`;

/** `config: null` = plugin offline since the hub started, or too old to report it. */
export async function getServerConfig(
  networkId: string,
  serverKeyId: string,
): Promise<{ config: ServerConfig | null; online: boolean }> {
  const res = await fetch(url(networkId, serverKeyId), { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export class ServerConfigError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string | null,
  ) {
    super(code);
  }
}

export async function patchServerConfig(
  networkId: string,
  serverKeyId: string,
  changes: ServerConfig,
): Promise<ServerConfig> {
  const res = await fetch(url(networkId, serverKeyId), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ServerConfigError(body?.error ?? `${res.status}`, body?.message ?? null);
  return body.config;
}
