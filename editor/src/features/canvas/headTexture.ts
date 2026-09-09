/**
 * Resolve an Appearance.head value to a previewable image URL.
 *  - basehead:<b64> / raw "eyJ…"  → decode → textures.minecraft.net hash → mc-heads 3D render
 *  - playerhead:<literal name>    → mc-heads by name (placeholders → undefined)
 *  - hdb:<id>                     → useHeadPreviewUrl resolves these through the connected server
 * Returns undefined whenever the value can't be resolved — caller falls back to the material texture.
 */
export function headPreviewUrl(head: string | undefined): string | undefined {
  if (!head) return undefined;
  if (head.startsWith("basehead:") || head.startsWith("eyJ")) {
    const b64 = head.startsWith("basehead:") ? head.slice("basehead:".length) : head;
    try {
      const json = JSON.parse(atob(b64)) as { textures?: { SKIN?: { url?: string } } };
      const hash = json.textures?.SKIN?.url?.match(/texture\/([0-9a-f]+)/i)?.[1];
      return hash ? `https://mc-heads.net/head/${hash}` : undefined;
    } catch {
      return undefined;
    }
  }
  if (head.startsWith("playerhead:")) {
    const name = head.slice("playerhead:".length).trim();
    if (!name || /[{%]/.test(name)) return undefined;
    return `https://mc-heads.net/head/${encodeURIComponent(name)}`;
  }
  return undefined;
}
