import type { ImportChoice, ImportConflict } from "./importMerge";

/** Sets the choice for one conflicting file. */
export function withChoice(
  choices: Record<string, ImportChoice>,
  path: string,
  choice: ImportChoice,
): Record<string, ImportChoice> {
  return { ...choices, [path]: choice };
}

/**
 * Extends a choice to every conflict from `index` on (current file included)
 * — the "keep this choice for all following files" checkbox.
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

/** Every conflict is resolved — the import can be applied. */
export function allConflictsResolved(
  choices: Record<string, ImportChoice>,
  conflicts: ImportConflict[],
): boolean {
  return conflicts.every((conflict) => choices[conflict.path] !== undefined);
}
