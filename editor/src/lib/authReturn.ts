export function safeAuthReturn(value: unknown, fallback = "/account"): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return fallback;
  return value;
}

export function pricingSignupUrl(planId: string): string {
  return `/signup?${new URLSearchParams({ next: `/pricing?${new URLSearchParams({ plan: planId })}` })}`;
}
