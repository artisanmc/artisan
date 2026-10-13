import { hashBytes } from "@/lib/contentHash";

/**
 * Merge of an imported Project (ZIP) against the server's current snapshot,
 * file by file.
 *
 * Two modes:
 * - **Overwrite**: the import becomes the new state; what the server held and
 *   the ZIP ignores disappears;
 * - **Merge**: start from the server state, add the import's files, and only
 *   files present on both sides with different content ask for a choice.
 *   Nothing is deleted.
 *
 * The grain is the file (ADR `no-branch-conflict-resolution`): no line-by-line
 * merge. Renames are not detected — an import does not carry that intent.
 */

export type ImportMode = "merge" | "overwrite";
export type ImportChoice = "import" | "server";

/** An imported binary, bytes included, with its identity already computed. */
export interface ImportBinary {
  bytes: Uint8Array;
  hash: string;
  size: number;
}

/** The tree of an imported Project, rel-keyed (paths without the project prefix). */
export interface ImportTree {
  files: Record<string, string>;
  binaries: Record<string, ImportBinary>;
}

/** The server's published state: text and image metadata. */
export interface ImportReference {
  files: Record<string, string>;
  binaries: Record<string, { hash: string; size: number }>;
}

export interface ImportConflict {
  path: string;
  kind: "text" | "binary";
  /** Server content for a text conflict; `null` for a binary. */
  server: string | null;
  /** Server identity for a binary conflict; `null` for a text. */
  serverBinary: { hash: string; size: number } | null;
}

export interface ImportDiff {
  /** Present only in the import — added without conflict. */
  additions: string[];
  /** Identical on both sides — nothing to do. */
  identical: string[];
  /** Present on both sides with different content — to resolve. */
  conflicts: ImportConflict[];
  /** Present only on the server — kept when merging, deleted when overwriting. */
  serverOnly: string[];
}

/** The resolved result: the final text tree and the images (bytes for those to publish). */
export interface ResolvedImport {
  files: Record<string, string>;
  binaries: Record<string, { hash: string; size: number; bytes?: Uint8Array }>;
}

const sort = (paths: string[]): string[] => paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Splits an imported tree (text + bytes) and computes the binaries' identity. */
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

/** What the import changes compared to the current snapshot. */
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
 * Resolves the import into a complete tree, meant for the draft.
 *
 * When merging, a conflict without a choice falls back to the import (the
 * import's intent is the target state); the modal validates nothing until
 * every file has been resolved — this default only exists for a direct call.
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

  // Merge: the server state is the base, the import is laid over it.
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
