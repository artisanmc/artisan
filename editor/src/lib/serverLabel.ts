/**
 * Returns a human-friendly display label for a server.
 * Falls back to "Server <short-id>" when no label is set.
 */
export function displayServerLabel(server: {
  id: string;
  label: string | null | undefined;
}): string {
  if (server.label && server.label.trim().length > 0) return server.label.trim();
  // Short recognisable fallback: "Server abc1" from the id. Row ids are
  // "srv_<hex>"; legacy/test ids use "sk_" or bare UUIDs.
  const bare = server.id.replace(/^(srv_|sk_)/, "");
  return `Server ${bare.slice(0, 4)}`;
}
