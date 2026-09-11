const flushers = new Set<() => void>();
export function registerDraftFlush(flush: () => void): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}
export function flushDraftEdits(): void {
  for (const flush of flushers) flush();
}
