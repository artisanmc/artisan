/**
 * Number shortening for the `compact()` method — mirrored by
 * `plugin/.../expr/Compact.kt` and pinned by the conformance vector.
 *
 * As is below 10,000, then one unit of K, M, B or T: `18.4K`, `184K`, `1.8M`, `12T`, at most five
 * characters up to 999T. Always rounded toward zero, so a balance never reads higher than it is
 * (999,999 is `999K`, not `1000K`); one decimal below 100 of a unit, never `.0`. Whole-number
 * arithmetic only, so both implementations agree digit for digit.
 */
const UNITS = ["K", "M", "B", "T"] as const;

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "";
  const whole = Math.trunc(value);
  const abs = Math.abs(whole);
  const sign = whole < 0 ? "-" : "";
  if (abs < 10_000) return sign + abs;
  let unit = 0;
  let divisor = 1_000;
  while (unit < UNITS.length - 1 && Math.floor(abs / divisor) >= 1_000) {
    divisor *= 1_000;
    unit++;
  }
  const units = Math.floor(abs / divisor);
  if (units >= 100) return sign + units + UNITS[unit];
  const tenth = Math.floor((abs % divisor) / (divisor / 10));
  return sign + units + (tenth === 0 ? "" : "." + tenth) + UNITS[unit];
}
