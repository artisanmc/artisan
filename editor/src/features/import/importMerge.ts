import { hashBytes } from "@/lib/contentHash";

/**
 * Fusion d'un Project importé (ZIP) contre l'instantané courant du serveur
 * (miroir backend), fichier par fichier.
 *
 * Deux modes :
 * - **Écraser** : l'import devient le nouvel état ; ce que le serveur portait
 *   et que le ZIP ignore disparaît ;
 * - **Fusionner** : on part de l'état serveur, on ajoute les fichiers de
 *   l'import, et seuls les fichiers présents des deux côtés avec un contenu
 *   différent demandent un choix. Rien n'est supprimé.
 *
 * Le grain est le fichier (ADR `no-branch-conflict-resolution`) : pas de
 * fusion ligne à ligne. Les renommages ne sont pas détectés — un import ne
 * transporte pas cette intention.
 */

export type ImportMode = "merge" | "overwrite";
export type ImportChoice = "import" | "server";

/** Un binaire importé, octets compris, avec son identité déjà calculée. */
export interface ImportBinary {
  bytes: Uint8Array;
  hash: string;
  size: number;
}

/** L'arbre d'un Project importé, rel-keyed (chemins sans le préfixe projet). */
export interface ImportTree {
  files: Record<string, string>;
  binaries: Record<string, ImportBinary>;
}

/** L'état publié du serveur (miroir) : texte et métadonnées d'images. */
export interface ImportReference {
  files: Record<string, string>;
  binaries: Record<string, { hash: string; size: number }>;
}

export interface ImportConflict {
  path: string;
  kind: "text" | "binary";
  /** Contenu serveur pour un conflit texte ; `null` pour un binaire. */
  server: string | null;
  /** Identité serveur pour un conflit binaire ; `null` pour un texte. */
  serverBinary: { hash: string; size: number } | null;
}

export interface ImportDiff {
  /** Présents seulement dans l'import — ajoutés sans conflit. */
  additions: string[];
  /** Identiques des deux côtés — rien à faire. */
  identical: string[];
  /** Présents des deux côtés, contenu différent — à trancher. */
  conflicts: ImportConflict[];
  /** Présents seulement sur le serveur — conservés en fusion, supprimés en écrasement. */
  serverOnly: string[];
}

/** Le résultat résolu : l'arbre texte final et les images (octets pour celles à publier). */
export interface ResolvedImport {
  files: Record<string, string>;
  binaries: Record<string, { hash: string; size: number; bytes?: Uint8Array }>;
}

const sort = (paths: string[]): string[] => paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Sépare un arbre importé (texte + octets) et calcule l'identité des binaires. */
export async function prepareImportTree(
  entries: Record<string, string | Uint8Array>,
): Promise<ImportTree> {
  const files: Record<string, string> = {};
  const binaries: Record<string, ImportBinary> = {};
  for (const [path, content] of Object.entries(entries)) {
    if (typeof content === "string") {
      files[path] = content;
      continue;
    }
    binaries[path] = { bytes: content, hash: await hashBytes(content), size: content.length };
  }
  return { files, binaries };
}

/** Ce que l'import change par rapport à l'instantané courant. */
export function diffImport(input: ImportTree, reference: ImportReference): ImportDiff {
  const additions: string[] = [];
  const identical: string[] = [];
  const conflicts: ImportConflict[] = [];

  for (const path of Object.keys(input.files)) {
    const server = reference.files[path];
    if (server === undefined) additions.push(path);
    else if (server === input.files[path]) identical.push(path);
    else conflicts.push({ path, kind: "text", server, serverBinary: null });
  }
  for (const path of Object.keys(input.binaries)) {
    const server = reference.binaries[path];
    if (server === undefined) additions.push(path);
    else if (server.hash === input.binaries[path]!.hash) identical.push(path);
    else conflicts.push({ path, kind: "binary", server: null, serverBinary: server });
  }

  const serverOnly = [...Object.keys(reference.files), ...Object.keys(reference.binaries)].filter(
    (path) => !(path in input.files) && !(path in input.binaries),
  );

  return {
    additions: sort(additions),
    identical: sort(identical),
    conflicts: sort(conflicts.map((c) => c.path)).map(
      (path) => conflicts.find((c) => c.path === path)!,
    ),
    serverOnly: sort(serverOnly),
  };
}

/**
 * Résout l'import en un arbre complet, destiné au brouillon.
 *
 * En fusion, un conflit sans choix retombe sur l'import (l'intention de
 * l'import est l'état visé) ; la modale, elle, ne valide rien tant que tous les
 * fichiers n'ont pas été tranchés — ce défaut n'est là que pour un appel direct.
 */
export function resolveImport(
  input: ImportTree,
  reference: ImportReference,
  mode: ImportMode,
  choices: Record<string, ImportChoice> = {},
): ResolvedImport {
  const files: Record<string, string> = {};
  const binaries: ResolvedImport["binaries"] = {};

  if (mode === "overwrite") {
    for (const [path, content] of Object.entries(input.files)) files[path] = content;
    for (const [path, bin] of Object.entries(input.binaries))
      binaries[path] = { hash: bin.hash, size: bin.size, bytes: bin.bytes };
    return { files, binaries };
  }

  // Fusion : l'état serveur est la base, l'import s'y superpose.
  for (const [path, content] of Object.entries(reference.files)) files[path] = content;
  for (const [path, bin] of Object.entries(reference.binaries))
    binaries[path] = { hash: bin.hash, size: bin.size };

  for (const [path, content] of Object.entries(input.files)) {
    const server = reference.files[path];
    if (server !== undefined && server !== content && choices[path] === "server") continue;
    files[path] = content;
  }
  for (const [path, bin] of Object.entries(input.binaries)) {
    const server = reference.binaries[path];
    if (server !== undefined && server.hash !== bin.hash && choices[path] === "server") continue;
    binaries[path] = { hash: bin.hash, size: bin.size, bytes: bin.bytes };
  }

  return { files, binaries };
}
