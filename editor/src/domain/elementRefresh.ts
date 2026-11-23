/**
 * `refresh_ticks` of a menu element: how often the plugin redraws it while the menu
 * is open (`MenuRefresh`, `ElementYaml.refreshPeriod`). Same bounds on both sides.
 */
export const MIN_REFRESH_TICKS = 2;
/** One hour: beyond, reopening the menu is the refresh. */
export const MAX_REFRESH_TICKS = 72000;

/** The value written for [ticks]: undefined (no refresh) when absent or not positive, else clamped. */
export function clampRefreshTicks(ticks: number | undefined): number | undefined {
  if (ticks === undefined || !Number.isFinite(ticks) || ticks <= 0) return undefined;
  return Math.min(MAX_REFRESH_TICKS, Math.max(MIN_REFRESH_TICKS, Math.round(ticks)));
}
