/**
 * URL-safe slug from a human name: diacritics stripped, lowercased, runs of
 * non-alphanumerics collapsed to single hyphens, trimmed. Empty input (or an
 * all-punctuation name) falls back to `fallback` so a slug is never empty.
 */
export function slugify(name: string, fallback = "item"): string {
	const base = name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "") // strip combining diacritics (é → e)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
	return base || fallback;
}

/**
 * Make `base` unique against the `taken` slugs by appending `-2`, `-3`, …
 * Returns `base` unchanged when it is free.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) {
		const candidate = `${base}-${i}`;
		if (!set.has(candidate)) return candidate;
	}
}
