import { apiFetch } from "./client";

/** Editable `config.yml` of a server, flat dotted keys (ADR `server-config-from-editor`). */
export type ServerConfig = Record<string, unknown>;

const path = (serverKeyId: string) =>
  `/api/v1/servers/${encodeURIComponent(serverKeyId)}/server-config`;

/** `config: null` = plugin offline since the hub started, or too old to report it. Rejects with an `ApiError`. */
export async function getServerConfig(
  serverKeyId: string,
): Promise<{ config: ServerConfig | null; online: boolean }> {
  return apiFetch(path(serverKeyId));
}

/** Rejects with an `ApiError`: its `code` is the hub's (`invalid_config`…), its `detail` the explanation. */
export async function patchServerConfig(
  serverKeyId: string,
  changes: ServerConfig,
): Promise<ServerConfig> {
  const body = await apiFetch<{ config: ServerConfig }>(path(serverKeyId), {
    method: "PATCH",
    json: { changes },
  });
  return body.config;
}
