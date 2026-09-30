import type { ImportChoice, ImportConflict } from "./importMerge";

/** Fixe le choix d'un fichier en conflit. */
export function withChoice(
  choices: Record<string, ImportChoice>,
  path: string,
  choice: ImportChoice,
): Record<string, ImportChoice> {
  return { ...choices, [path]: choice };
}

/**
 * Étend un choix à tous les conflits à partir de `index` (le fichier courant
 * inclus) — la case « garder ce choix pour tous les fichiers suivants ».
 */
export function withChoiceForRemaining(
  choices: Record<string, ImportChoice>,
  conflicts: ImportConflict[],
  index: number,
  choice: ImportChoice,
): Record<string, ImportChoice> {
  const next = { ...choices };
  for (let i = Math.max(0, index); i < conflicts.length; i++) next[conflicts[i]!.path] = choice;
  return next;
}

/** Tous les conflits sont tranchés — l'import peut être appliqué. */
export function allConflictsResolved(
  choices: Record<string, ImportChoice>,
  conflicts: ImportConflict[],
): boolean {
  return conflicts.every((conflict) => choices[conflict.path] !== undefined);
}
