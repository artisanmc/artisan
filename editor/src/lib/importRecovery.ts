export const importRecovery = new Map<string, unknown>();
export const IMPORT_RECOVERY_PREFIX = "artisan:import-recovery:";
let generation = 0;
export const importRecoveryGeneration = () => generation;
export function clearImportRecovery() {
  generation++;
  importRecovery.clear();
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(IMPORT_RECOVERY_PREFIX)) sessionStorage.removeItem(key);
  }
}
