/**
 * Reference to a Document from another Document (target of an `open_menu`,
 * an `open_dialog`…).
 *
 * - `main`: **bare** id, resolved first in the referencing project, then on
 *   the server if it is defined there only once.
 * - `boutique:main`: id **qualified** by a project's namespace — the name of
 *   its folder on the server's disk.
 *
 * `:` can appear neither in a project folder name (rejected by the plugin)
 * nor in a Windows file name, so it never splits an id.
 */
export interface DocRef {
  namespace: string | null;
  id: string;
}

export function parseDocRef(raw: string): DocRef {
  const at = raw.indexOf(":");
  if (at <= 0 || at === raw.length - 1) return { namespace: null, id: raw };
  return { namespace: raw.slice(0, at), id: raw.slice(at + 1) };
}

/**
 * The Documents a reference reaches, among those carrying its id
 * (`candidatesOf(id)`): 0 = not found, 1 = resolved, more = ambiguous.
 * Locked with the plugin (`DocumentTable`) by `testdata/doc-ref-conformance.json`.
 */
export function resolveDocRef<T extends { namespace: string; projectId: string }>(
  candidatesOf: (id: string) => T[],
  fromProjectId: string | null,
  raw: string,
): T[] {
  const ref = parseDocRef(raw);
  const all = candidatesOf(ref.id);
  if (ref.namespace !== null) return all.filter((t) => t.namespace === ref.namespace);
  const local = fromProjectId === null ? [] : all.filter((t) => t.projectId === fromProjectId);
  return local.length > 0 ? local : all;
}

/** A project's namespace: its disk folder, which may differ from its internal id. */
export const projectNamespace = (project: { id: string; diskId?: string }): string =>
  project.diskId ?? project.id;
