/** Localized integer (credits / tokens). */
export function formatCredits(n: number, lang = "en"): string {
  return new Intl.NumberFormat(lang).format(Math.round(n));
}
export const formatTokens = formatCredits;

/** micro-USD → "$X.XX" in the given locale. Negative renders "-$X.XX". */
export function formatUsdFromMicro(micro: number, lang = "en"): string {
  return new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).format(
    micro / 1_000_000,
  );
}
