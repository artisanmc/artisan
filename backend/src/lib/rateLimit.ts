const limits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = limits.get(key);
  if (!entry || entry.resetAt < now) {
    limits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}
