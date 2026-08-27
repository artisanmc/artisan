/**
 * Credits to bill per 1M tokens, suggested from the model's real provider price.
 * `realUsdMicroPerM` and `creditUsdMicroRate` are both micro-USD. Ceil so a
 * priced model never suggests zero. null = no usable credit rate configured.
 */
export function suggestCreditsPerM(
  realUsdMicroPerM: number,
  creditUsdMicroRate: number,
  marginPct: number,
): number | null {
  if (!Number.isFinite(creditUsdMicroRate) || creditUsdMicroRate <= 0) return null;
  if (!Number.isFinite(realUsdMicroPerM) || realUsdMicroPerM <= 0) return 0;
  const margin = Number.isFinite(marginPct) ? Math.max(0, marginPct) : 0;
  return Math.ceil((realUsdMicroPerM * (1 + margin / 100)) / creditUsdMicroRate);
}
