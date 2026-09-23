export function allowedWebOrigin(editorUrl: string, marketingUrl: string) {
  const allowed = new Set([editorUrl, marketingUrl].filter(Boolean));
  return (origin: string): string => allowed.has(origin) ? origin : "";
}
