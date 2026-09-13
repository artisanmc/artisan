import type { ProjectDraft } from "./draft";
function merge<T>(
  before: Record<string, T> = {},
  local: Record<string, T> = {},
  saved: Record<string, T> = {},
) {
  const result = { ...saved };
  for (const key of new Set([...Object.keys(before), ...Object.keys(local)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(local[key])) continue;
    if (key in local) result[key] = local[key]!;
    else delete result[key];
  }
  return result;
}
export function mergeDraftAssetResult(
  before: ProjectDraft,
  local: ProjectDraft,
  saved: ProjectDraft,
): ProjectDraft {
  return {
    ...local,
    tree: merge(before.tree, local.tree, saved.tree),
    binaryTree: merge(before.binaryTree, local.binaryTree, saved.binaryTree),
  };
}
