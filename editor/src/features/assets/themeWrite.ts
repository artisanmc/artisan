import { writeProjectFiles } from "@/lib/api/projectFiles";
import { hashContent } from "@/lib/contentHash";
import { THEME_COLORS_FILES, themeColorsText } from "@/lib/pack/theme";
import type { KitRead } from "@/state/kitStore";

/**
 * Writes the table `colors` in the file of a theme of its own folder (`overrides/colors.yml`),
 * on the server's disk: the file's other keys are kept (`themeColorsText`), and a file left
 * with nothing is deleted. `theme` is the theme's Project as published, whose content the
 * write is checked against: a file changed since then is refused (`conflict`), nothing written.
 * Whether a file was written; throws the refusal's code otherwise.
 */
export async function saveThemeColors(
  theme: KitRead,
  colors: ReadonlyMap<number, number>,
): Promise<boolean> {
  const path = THEME_COLORS_FILES.find((file) => file in theme.files) ?? THEME_COLORS_FILES[0];
  const before = theme.files[path];
  const content = themeColorsText(before, colors);
  if (content === (before ?? null)) return false;
  const base_hash = before === undefined ? null : await hashContent(before);
  const result = await writeProjectFiles(
    theme.projectId,
    content === null
      ? { files: [], deletes: [{ path, base_hash }] }
      : { files: [{ path, content, base_hash }], deletes: [] },
  );
  if (!result.ok) throw new Error(result.error);
  return true;
}
