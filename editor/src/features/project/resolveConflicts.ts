import type { ProjectFileConflict } from "@/lib/api/projectFiles";

export type ConflictChoice = "mine" | "disk";

export interface ResolutionOutcome {
  /** La base à installer avant de ré-enregistrer. */
  nextBaseline: Record<string, string>;
  /** Contenus disque à réintégrer dans l'arbre de l'éditeur (choix « disque »). */
  adoptFromDisk: Record<string, string>;
  /** Chemins à retirer de l'arbre de l'éditeur (supprimés sur disque, choix « disque »). */
  removeFromTree: string[];
  /** Conflits laissés sans choix — l'appelant ne doit pas enregistrer tant qu'il en reste. */
  unresolved: string[];
}

/**
 * Traduit les choix de l'admin en un seul geste : **adopter le contenu disque
 * comme base** (ADR `server-disk-only-storage`, P2).
 *
 * C'est ce qui rend les deux options symétriques et sans cas particulier :
 * - « garder ma version » → seule la base bouge, donc le ré-enregistrement porte
 *   le jeton que le plugin attend et écrase légitimement ;
 * - « prendre celle du serveur » → la base *et* l'arbre de l'éditeur bougent,
 *   donc il ne reste plus rien à écrire pour ce fichier.
 *
 * Un fichier sans choix n'est pas tranché à la place de l'admin : il ressort
 * dans `unresolved`, et l'enregistrement reste bloqué. C'est la même règle que
 * côté plugin — un défaut silencieux sur une donnée contestée, c'est de la
 * perte de données déguisée en ergonomie.
 */
export function applyResolutions(
  baseline: Record<string, string>,
  conflicts: ProjectFileConflict[],
  choices: Record<string, ConflictChoice>,
): ResolutionOutcome {
  const nextBaseline = { ...baseline };
  const adoptFromDisk: Record<string, string> = {};
  const removeFromTree: string[] = [];
  const unresolved: string[] = [];

  for (const conflict of conflicts) {
    const choice = choices[conflict.path];
    if (!choice) {
      unresolved.push(conflict.path);
      continue;
    }
    // Dans les deux cas la base épouse le disque : c'est ce qu'on sait
    // désormais y être. `null` (fichier supprimé sur disque) se représente par
    // l'absence d'entrée — la même chose que « fichier neuf », donc un seul
    // mécanisme pour les deux.
    if (conflict.disk === null) delete nextBaseline[conflict.path];
    else nextBaseline[conflict.path] = conflict.disk;

    if (choice === "disk") {
      if (conflict.disk === null) removeFromTree.push(conflict.path);
      else adoptFromDisk[conflict.path] = conflict.disk;
    }
  }

  return { nextBaseline, adoptFromDisk, removeFromTree, unresolved };
}
