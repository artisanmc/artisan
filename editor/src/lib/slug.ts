/**
 * URL-safe slug from a human name — mirror of backend/src/lib/slug.ts
 * (diacritics stripped, lowercased, non-alphanumerics collapsed to hyphens).
 * The backend rejects slugs that aren't already canonical, so the UI
 * normalises as the user types.
 */
export function slugify(name: string, fallback = "item"): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || fallback;
}
