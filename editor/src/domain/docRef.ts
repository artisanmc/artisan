/**
 * Référence à un Document depuis un autre Document (cible d'un `open_menu`,
 * d'un `open_dialog`…).
 *
 * - `main` : id **nu**, résolu d'abord dans le project qui référence, puis sur le
 *   serveur s'il n'y est défini qu'une fois.
 * - `boutique:main` : id **qualifié** par le namespace d'un project — le nom de
 *   son dossier sur le disque du serveur.
 *
 * `:` ne peut figurer ni dans un nom de dossier de project (refusé par le plugin)
 * ni dans un nom de fichier sous Windows, donc il ne coupe jamais un id.
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
 * Les Documents qu'une référence atteint, parmi ceux qui portent son id
 * (`candidatesOf(id)`) : 0 = introuvable, 1 = résolue, plus = ambiguë.
 * Verrouillé avec le plugin (`DocumentTable`) par `testdata/doc-ref-conformance.json`.
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

/** Le namespace d'un project : son dossier disque, qui peut différer de son id interne. */
export const projectNamespace = (project: { id: string; diskId?: string }): string =>
  project.diskId ?? project.id;
