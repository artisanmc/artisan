/**
 * The Element domain type stores `positions: string` — a comma-separated list
 * of slot indices and ranges, e.g. "13", "0,1,2", "0-8", "0-8,17,26".
 *
 * One element can fill many slots so a decoration / glass-pane border can be
 * defined once and updated in one place. parsePositions turns the string into
 * a sorted set of unique numbers; formatPositions inverts (compressing runs).
 */

export function parsePositions(input: string | undefined): number[] {
  if (!input) return [];
  const out = new Set<number>();
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const dash = trimmed.indexOf("-");
    if (dash > 0) {
      const start = Number(trimmed.slice(0, dash));
      const end = Number(trimmed.slice(dash + 1));
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i++) out.add(i);
    } else {
      const n = Number(trimmed);
      if (!Number.isNaN(n)) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Compress a sorted list of unique slot indices into the canonical string. */
export function formatPositions(positions: readonly number[]): string {
  if (positions.length === 0) return "";
  const sorted = [...positions].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let end = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n === end + 1) {
      end = n;
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = n;
      end = n;
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(",");
}

export const positionsContains = (positions: string, target: number): boolean =>
  parsePositions(positions).includes(target);

export const removePosition = (positions: string, target: number): string =>
  formatPositions(parsePositions(positions).filter((p) => p !== target));

export const addPosition = (positions: string, target: number): string =>
  formatPositions([...new Set([...parsePositions(positions), target])]);
