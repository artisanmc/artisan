/**
 * Returns a human-friendly display label for a server.
 * Falls back to "Server <short-id>" when no label is set.
 */
export function displayServerLabel(server: { id: string; label: string | null | undefined }): string {
  if (server.label && server.label.trim().length > 0) return server.label.trim();
  // Short recognisable fallback: "Server abc1" from the id.
  const short = server.id.startsWith("sk_") ? server.id.slice(3, 7) : server.id.slice(0, 4);
  return `Server ${short}`;
}
