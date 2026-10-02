/** A Project working copy and its server baseline. Draft persistence is separate from publication. */
/** Un renommage déclaré par l'éditeur, en chemins relatifs. */
export interface PendingRename {
  from: string;
  to: string;
}

export interface ProjectDraft {
  binaryBaseline?: Record<string, { hash: string; size: number }>;
  binaryTree?: Record<string, { hash: string; size: number }>;
  remote?: {
    id: string;
    name: string;
    revision: number;
    ownerId: string;
    acknowledged?: string;
    /**
     * L'arbre de la révision acquittée : le dernier point commun avec les autres
     * sessions, contre lequel on fusionne leur travail. Distinct de `baseline`,
     * qui reste le disque publié.
     */
    base?: {
      tree: Record<string, string>;
      binaryTree?: Record<string, { hash: string; size: number }>;
    };
    pendingMutation?: {
      operationId: string;
      kind: "save" | "copy" | "publish" | "discard" | "asset";
      asset?: { suffix: string; method: string; fields: Record<string, string>; file?: { name: string; type: string; base64: string } };
      id: string;
      revision: number;
      name: string;
      snapshot?: ProjectDraft;
    };
  };
  /** L'arbre tel que le serveur l'avait chargé, rel-keyed. */
  baseline: Record<string, string>;
  /** L'arbre tel que l'éditeur l'affiche — ce qui partira à l'enregistrement. */
  tree: Record<string, string>;
  /**
   * L'arbre **juste après le chargement**, avant toute édition.
   *
   * C'est lui, et non les octets du serveur, qui répond à « as-tu modifié
   * quelque chose ? ». Ouvrir un Project applique des transformations —
   * injection des models déclarés, abandon d'une source legacy, mise en forme
   * canonique d'un fichier écrit à la main — qui font légitimement différer
   * l'arbre des octets disque **sans que personne n'ait rien touché**. Comparer
   * aux octets ferait annoncer « travail non enregistré » sur un Project qu'on
   * vient d'ouvrir.
   */
  initialTree?: Record<string, string>;
  /** Millis de la prise de la base : l'âge du brouillon, à afficher. */
  at: number;
  /**
   * Renommages déclarés depuis le dernier enregistrement.
   *
   * Persistés avec le brouillon à dessein : l'arbre porte déjà le nouveau nom,
   * donc perdre cette liste à un rechargement ferait retomber le renommage en
   * « suppression + création » — et avec, la corbeille et l'historique du
   * fichier.
   */
  renames?: PendingRename[];
}

/**
 * Y a-t-il du travail non enregistré ?
 *
 * Comparaison de contenus, **sans hachage** : cet indicateur est permanent, il
 * doit être gratuit. Le hachage n'intervient qu'à l'enregistrement, où il sert à
 * autre chose — vérifier que le disque n'a pas bougé.
 */
export function isDirty(
  reference: Record<string, string> | undefined,
  tree: Record<string, string>,
): boolean {
  const base = reference ?? {};
  const baseKeys = Object.keys(base);
  const treeKeys = Object.keys(tree);
  if (baseKeys.length !== treeKeys.length) return true;
  return treeKeys.some((k) => base[k] !== tree[k]);
}

export function hasDraftChanges(draft: ProjectDraft): boolean {
  if (isDirty(draft.initialTree, draft.tree)) return true;
  const baseline = draft.binaryBaseline ?? {};
  const tree = draft.binaryTree ?? {};
  return (
    Object.keys(baseline).length !== Object.keys(tree).length ||
    Object.entries(tree).some(
      ([path, value]) => value.hash !== baseline[path]?.hash || value.size !== baseline[path]?.size,
    )
  );
}

/**
 * Âge du brouillon, dans l'unité qui se lit.
 *
 * Un arrondi aux heures pleines produisait « basé sur l'état d'il y a 0 h » pour
 * un brouillon de dix minutes — une phrase qui ne veut rien dire et qui donne
 * l'impression d'un compteur cassé.
 */
export type DraftAge =
  | { unit: "now"; value: 0 }
  | { unit: "minutes"; value: number }
  | { unit: "hours"; value: number }
  | { unit: "days"; value: number };

export function draftAge(at: number, now: number = Date.now()): DraftAge {
  const ms = Math.max(0, now - at);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return { unit: "now", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: "hours", value: hours };
  return { unit: "days", value: Math.floor(hours / 24) };
}
