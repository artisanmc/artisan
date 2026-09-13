export const COPY_RECOVERY_PREFIX = "artisan:copy-recovery:";
export const copyRecovery = new Map<string, unknown>();
let generation = 0;
export const copyRecoveryGeneration = () => generation;
export function clearCopyRecovery() {
  generation++;
  copyRecovery.clear();
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(COPY_RECOVERY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* A blocked browser store has no accessible recovery data. */
  }
}
