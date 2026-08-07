/**
 * Duration rendering for the `until()` method — mirrored by
 * `plugin/.../expr/Duration.kt` and pinned by the conformance vector.
 *
 * Units are project data: they come from the translations under the reserved
 * `artisan.duration.*` keys, so they follow the viewer's language (ADR
 * `expression-parity` §7). The defaults below are the fallback when a project
 * has no such keys — identical in both implementations, which is why they live
 * in one named place rather than inline.
 */
export const DURATION_KEYS = {
  days: "artisan.duration.days",
  hours: "artisan.duration.hours",
  minutes: "artisan.duration.minutes",
  seconds: "artisan.duration.seconds",
} as const;

export const DURATION_DEFAULTS: Record<keyof typeof DURATION_KEYS, string> = {
  days: "{n}d",
  hours: "{n}h",
  minutes: "{n}m",
  seconds: "{n}s",
};

const MS = { days: 86_400_000, hours: 3_600_000, minutes: 60_000, seconds: 1000 } as const;
const LADDER = ["days", "hours", "minutes", "seconds"] as const;

/**
 * Human duration between now and an instant.
 *
 * Shows the most significant non-zero unit plus the next one down when it is
 * also non-zero — `3h 12m`, `2d 5h`, `45s`. Two units is the sweet spot for a
 * lore line: enough precision to be useful, short enough not to wrap.
 *
 * A past or zero delta renders zero seconds rather than a negative or an empty
 * string: a countdown that has run out should read `0s`.
 */
export function formatDuration(deltaMs: number, translate: (key: string) => string | undefined): string {
  const unit = (name: keyof typeof MS, n: number): string => {
    const pattern = translate(DURATION_KEYS[name]) ?? DURATION_DEFAULTS[name];
    return pattern.replace("{n}", String(n));
  };

  if (deltaMs <= 0) return unit("seconds", 0);

  let rest = Math.floor(deltaMs);
  const values: Record<string, number> = {};
  for (const name of LADDER) {
    values[name] = Math.floor(rest / MS[name]);
    rest -= values[name]! * MS[name];
  }

  const firstIndex = LADDER.findIndex((name) => values[name]! > 0);
  if (firstIndex === -1) return unit("seconds", 0);

  const head = LADDER[firstIndex]!;
  const parts = [unit(head, values[head]!)];
  const next = LADDER[firstIndex + 1];
  if (next && values[next]! > 0) parts.push(unit(next, values[next]!));
  return parts.join(" ");
}
