import { sha256Hex } from "./sha256";

/**
 * SHA-256 of a file's content, lowercase hex.
 *
 * The save's compare-and-swap token (ADR `server-disk-only-storage`): exact
 * mirror of the plugin's `ContentHash.hashContent`. Unrelated to the tree
 * hash — no key, no sorting, just the UTF-8 content.
 */
export async function hashContent(content: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(content));
}

/**
 * SHA-256 of a binary file's bytes (image, font), lowercase hex.
 *
 * Mirror of the plugin's `ContentHash.hashBytes`, and of an asset's `hash`
 * metadata: the identity of a binary in the trees (disk, mirror, draft).
 */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return sha256Hex(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
