import { apiFetch } from "./client";

/**
 * The editor's address on the tunnel server and its name (ADR `editor-tunnel`).
 * `tunnel: false`: the hub is reached at its own address (`web.url`), nothing to name.
 */
export interface EditorAddress {
  tunnel: boolean;
  connected?: boolean;
  url?: string | null;
  name?: string | null;
  /** False when the tunnel server keeps no names. */
  names?: boolean;
  /** What a name is followed by: `.artisanmc.app`. */
  suffix?: string | null;
}

export interface TakenAddress {
  name: string | null;
  url: string;
  /** A sign-in link on the new address: the session stays on the old one. */
  login: string | null;
}

const PATH = "/api/v1/editor-address";

/** Same rule as the tunnel server's: 3 to 32 lowercase letters, digits and inner hyphens. */
export const validAddressName = (name: string) =>
  /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(name) && !name.includes("--");

export function getEditorAddress(): Promise<EditorAddress> {
  return apiFetch(PATH);
}

/**
 * Resolves when [name] is free; rejects with an `ApiError` whose `code` is the
 * tunnel server's: `taken`, `reserved`, `invalid`, `too_many`, `unavailable`, `offline`.
 */
export async function checkAddressName(name: string): Promise<void> {
  await apiFetch(PATH, { method: "POST", json: { name, check: true } });
}

/** Takes [name]; an empty one gives the name back. Rejects like `checkAddressName`. */
export function takeAddressName(name: string): Promise<TakenAddress> {
  return apiFetch(PATH, { method: "POST", json: { name } });
}
