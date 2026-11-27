import type { DiskAsset } from "@/lib/pack/diskAssets";
import { themeModuleDrawingPath, themeModuleImage } from "@/lib/pack/theme";
import { parse } from "yaml";

/**
 * A theme's images of modules (ADR `themes-reach-modules`, decision 3): the files
 * `overrides/<module>/<image>.png` of a theme's Project, which replace that module's image of
 * the name while the theme is in place. The editor lists them among the theme's images, each
 * under the id `<module>/<image>` and with its module (`Asset.under`). The size it shows is
 * read from the descriptor it writes beside the file; the packs read the PNG alone.
 */

/** The id of the theme's image of the module `module`'s `name`. */
export const moduleImageId = (module: string, name: string): string => `${module}/${name}`;

/** Where the descriptor of such an image is. */
export const moduleImageDescriptorPath = (module: string, name: string): string =>
  themeModuleDrawingPath(module, name).replace(/\.png$/, ".yml");

const size = (text: string | undefined): { width: number; height: number } => {
  try {
    const meta = parse(text ?? "") as { width?: unknown; height?: unknown } | null;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    return { width: n(meta?.width), height: n(meta?.height) };
  } catch {
    return { width: 0, height: 0 };
  }
};

/** The images of modules among a theme's files, sorted by path. */
export function themeModuleAssets(
  projectId: string,
  files: readonly { path: string; content: string }[],
  binaries: readonly { path: string; hash: string }[],
): DiskAsset[] {
  const out: DiskAsset[] = [];
  const now = new Date();
  for (const bin of [...binaries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    const at = themeModuleImage(bin.path);
    if (!at) continue;
    const descriptor = moduleImageDescriptorPath(at.module, at.name);
    out.push({
      path: bin.path,
      hash: bin.hash,
      row: {
        id: moduleImageId(at.module, at.name),
        projectId,
        type: "texture",
        name: at.name,
        under: at.module,
        usages: [],
        ...size(files.find((f) => f.path === descriptor)?.content),
        ascent: null,
        codepoint: null,
        contentWidth: null,
        fontMeta: null,
        contentHash: bin.hash,
        createdAt: now,
        updatedAt: now,
      } as DiskAsset["row"],
    });
  }
  return out;
}
