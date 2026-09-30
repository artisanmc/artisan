/**
 * SHA-256 d'un contenu de fichier, hex minuscule.
 *
 * C'est le jeton de compare-and-swap de l'enregistrement (ADR
 * `server-disk-only-storage`) : miroir exact de `BundleHasher.hashContent`
 * côté plugin. Rien à voir avec le hash d'arbre — pas de clé, pas de tri,
 * juste le contenu en UTF-8.
 */
export async function hashContent(content: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(content));
}

/**
 * SHA-256 des octets d'un fichier binaire (image, police), hex minuscule.
 *
 * Miroir de `BundleHasher.hashBytes` côté plugin, et de la métadonnée `hash`
 * d'un asset : c'est l'identité d'un binaire dans les arbres (disque, miroir,
 * brouillon).
 */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
