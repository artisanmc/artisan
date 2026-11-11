import { yamlStem } from "@/lib/yamlFiles";

const PREFIX = "originals/";

/**
 * Each entry at the path it takes in the module's folder (design `originaux-modules`): the
 * owner's where they are, a shipped one (`originals/…`) at its path without the prefix unless
 * the owner has that file (`x.yml` and `x.yaml` name the same one). The owner's come first,
 * each list in input order. `ShippedView.kt` does the same for the hub's build.
 */
export function shippedView<T extends { path: string }>(
  entries: readonly T[],
): { entry: T; at: string }[] {
  const same = (path: string) => yamlStem(path) ?? path;
  const own = entries.filter((e) => !e.path.startsWith(PREFIX));
  const taken = new Set(own.map((e) => same(e.path)));
  const out = own.map((entry) => ({ entry, at: entry.path }));
  for (const entry of entries) {
    if (!entry.path.startsWith(PREFIX)) continue;
    const at = entry.path.slice(PREFIX.length);
    if (!taken.has(same(at))) out.push({ entry, at });
  }
  return out;
}

/** [files] as the module's folder shows them: the owner's over what the module ships. */
export function filesWithOriginals<T extends { path: string; content: string }>(
  files: readonly T[],
): { path: string; content: string }[] {
  return shippedView(files).map(({ entry, at }) => ({ path: at, content: entry.content }));
}
