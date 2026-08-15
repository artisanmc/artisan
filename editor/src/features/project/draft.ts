/**
 * Le brouillon d'un Project : la **base** (ce que le serveur avait chargé) et
 * l'**arbre courant** (ce que l'éditeur affiche), gardés dans le navigateur.
 *
 * Révise les décisions 3 et 7 de l'ADR `server-disk-only-storage`, qui
 * excluaient tout brouillon persistant et rendaient un Project inouvrable
 * serveur éteint. L'argument d'alors portait sur le coût : il aurait fallu
 * construire la réconciliation. Elle existe désormais — base, compare-and-swap
 * par fichier, modale de conflit — et le brouillon la réutilise telle quelle.
 *
 * Il reste par-appareil, par-utilisateur, et meurt avec le cache. Ce n'est plus
 * une régression pour autant : sans lui, tout est perdu au rechargement de page.
 */
export interface ProjectDraft {
  /** L'arbre tel que le serveur l'avait chargé, rel-keyed. */
  baseline: Record<string, string>;
  /** L'arbre tel que l'éditeur l'affiche — ce qui partira à l'enregistrement. */
  tree: Record<string, string>;
  /** Millis de la prise de la base : l'âge du brouillon, à afficher. */
  at: number;
}

/**
 * Y a-t-il du travail non enregistré ?
 *
 * Comparaison de contenus, **sans hachage** : cet indicateur est permanent, il
 * doit être gratuit. Le hachage n'intervient qu'à l'enregistrement, où il sert à
 * autre chose — vérifier que le disque n'a pas bougé.
 */
export function isDirty(
  baseline: Record<string, string> | undefined,
  tree: Record<string, string>,
): boolean {
  const base = baseline ?? {};
  const baseKeys = Object.keys(base);
  const treeKeys = Object.keys(tree);
  if (baseKeys.length !== treeKeys.length) return true;
  return treeKeys.some((k) => base[k] !== tree[k]);
}

/** Âge du brouillon en heures pleines — de quoi dire « basé sur l'état d'il y a N h ». */
export function draftAge(at: number, now: number = Date.now()): number {
  return Math.floor(Math.max(0, now - at) / 3_600_000);
}
