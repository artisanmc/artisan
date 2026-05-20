export interface ConflictDiff {
  addedOnDisk: string[];
  removedOnDisk: string[];
  modifiedOnDisk: string[];
}

export function computeConflictDiff(
  diskFiles: Record<string, string>,
  backendFiles: Record<string, string>,
): ConflictDiff {
  const diskKeys = new Set(Object.keys(diskFiles));
  const backendKeys = new Set(Object.keys(backendFiles));
  const addedOnDisk: string[] = [];
  const removedOnDisk: string[] = [];
  const modifiedOnDisk: string[] = [];
  for (const k of diskKeys) {
    if (!backendKeys.has(k)) addedOnDisk.push(k);
    else if (diskFiles[k] !== backendFiles[k]) modifiedOnDisk.push(k);
  }
  for (const k of backendKeys) {
    if (!diskKeys.has(k)) removedOnDisk.push(k);
  }
  return { addedOnDisk, removedOnDisk, modifiedOnDisk };
}
