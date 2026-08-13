/**
 * SHA-256 d'un contenu de fichier, hex minuscule.
 *
 * C'est le jeton de compare-and-swap de l'enregistrement (ADR
 * `server-disk-only-storage`) : miroir exact de `BundleHasher.hashContent`
 * côté plugin. Rien à voir avec le hash d'arbre — pas de clé, pas de tri,
 * juste le contenu en UTF-8.
 */
export async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
