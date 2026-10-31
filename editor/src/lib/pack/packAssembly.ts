import { type BedrockMenu, bedrockMenusFromProject } from "./bedrock/bedrockMenus";
import { buildBedrockPack } from "./bedrock/bedrockPack";
import { type DiskAsset, diskAssetsFromTree } from "./diskAssets";
import type { TextUpTexture } from "./fontJsonBuilder";
import { type ImageButtonPlacement, imageButtonsFromMenus } from "./imageButtons";
import { type GlyphPlacement, glyphPlacementsFromMenus } from "./menuGlyphPlacements";
import type { OverlayImageRequest } from "./overlayImages";
import { type AssetRow, type BuildResult, buildResourcePackZip } from "./resourcePackBuilder";
import { type GlyphContribution, mergeCodepoints } from "./rpCodepointMerger";
import {
  GUI_CONTAINERS,
  type GuiContainer,
  containerTextureSource,
  transparentContainersFromMenus,
} from "./vanillaGui";

/** One Project as the pack reads it: its text files, its binaries' fingerprints and a way to read their bytes. */
export interface PackProject {
  /** The Project id the pack anchors its assets to (`<server>.<folder>` off the hub). */
  id: string;
  files: { path: string; content: string }[];
  binaries: { path: string; hash: string; size: number }[];
  /** A binary's bytes; `undefined` skips it, a throw fails the whole build. */
  binary(path: string): Promise<Uint8Array | undefined>;
  /** The module images this Project's files ask for (`pack.images`, resolved by the caller). */
  overlayImages?: OverlayImageRequest[];
  /** The Project's folder on disk, which names it on the plugin side (Bedrock menu keys); defaults to `id`. */
  folder?: string;
}

export interface PackInput {
  projects: PackProject[];
  /** `resource-pack.container-textures.*` from `config.yml`, as `<project>:<asset>` refs. */
  containerTextures: Partial<Record<GuiContainer, string>>;
  /** Vanilla container texture, read only for a container without its own. */
  vanillaTexture(container: GuiContainer): Promise<Uint8Array>;
  /** The padded vanilla font textures (`*_up.png`). */
  textUp: Record<TextUpTexture, Uint8Array>;
  /** Redraw the containers a menu makes transparent (`vanilla_gui_v1`); true for every current plugin. */
  transparentContainers?: boolean;
  /** Also build the Bedrock pack (`bedrock/bedrockPack.ts`) for this server. */
  bedrock?: { serverId: string };
}

export interface ServerPacks extends BuildResult {
  /** Present when `PackInput.bedrock` was asked for. */
  bedrock?: { bytes: Uint8Array; hash: string };
}

/**
 * The server's Java pack from its Projects: the one assembly shared by the editor
 * (`buildServerPack`), the conformance vectors and the command-line build, so none of them
 * can drift from the others.
 *
 * Project order: by id, stable from one build to the next; the first one wins codepoint
 * collisions.
 */
export async function assembleServerPack(input: PackInput): Promise<ServerPacks> {
  const projects = [...input.projects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const allAssets: AssetRow[] = [];
  const contribs: GlyphContribution[] = [];
  const glyphPngs = new Map<string, Uint8Array>();
  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();
  const glyphPlacements: GlyphPlacement[] = [];
  const imageButtons: ImageButtonPlacement[] = [];
  const transparent = new Set<GuiContainer>();
  const imagesByRef: { ref: string; bytes: Uint8Array }[] = [];
  const overlayImages: OverlayImageRequest[] = [];
  const bedrockMenus: BedrockMenu[] = [];

  for (const project of projects) {
    const { files } = project;
    glyphPlacements.push(...glyphPlacementsFromMenus(files));
    imageButtons.push(...imageButtonsFromMenus(files));
    overlayImages.push(...(project.overlayImages ?? []));
    for (const c of transparentContainersFromMenus(files)) transparent.add(c);
    // Keyed by the folder name: the plugin names a menu's Project that way.
    if (input.bedrock)
      bedrockMenus.push(...bedrockMenusFromProject(project.folder ?? project.id, files));
    const fromDisk: DiskAsset[] = diskAssetsFromTree(project.id, files, project.binaries);

    contribs.push({
      projectId: project.id,
      glyphs: fromDisk
        .filter((a) => a.row.type === "glyph" && a.row.codepoint !== null)
        .map((a) => ({ assetId: a.row.id, codepoint: a.row.codepoint! })),
    });
    for (const a of fromDisk) {
      allAssets.push(a.row);
      if ((a.row.type === "glyph" && a.row.codepoint !== null) || a.row.type === "texture") {
        const bytes = await project.binary(a.path);
        if (!bytes) continue;
        glyphPngs.set(a.row.id, bytes);
        imagesByRef.push({ ref: `${project.id}:${a.row.name}`, bytes });
        continue;
      }
      if (a.row.type !== "font") continue;
      // A font is unpacked on disk: its glyphs are sibling files of the descriptor.
      const meta = a.row.fontMeta as { glyphMap?: { texture: string }[] } | null;
      const dir = a.path.slice(0, a.path.lastIndexOf("/"));
      const fontMap = new Map<string, Uint8Array>();
      for (const g of meta?.glyphMap ?? []) {
        const bytes = await project.binary(`${dir}/${g.texture}`);
        if (bytes) fontMap.set(g.texture, bytes);
      }
      if (fontMap.size > 0) fontGlyphPngs.set(a.row.id, fontMap);
    }
  }

  const { finalCodepoints } = mergeCodepoints(contribs);
  const sources = {} as Record<GuiContainer, Uint8Array>;
  for (const container of GUI_CONTAINERS) {
    sources[container] =
      containerTextureSource(imagesByRef, input.containerTextures[container]) ??
      (await input.vanillaTexture(container));
  }

  const java = buildResourcePackZip(
    allAssets,
    glyphPngs,
    fontGlyphPngs,
    { finalCodepoints },
    glyphPlacements,
    imageButtons,
    { sources, transparent: input.transparentContainers === false ? new Set() : transparent },
    input.textUp,
    overlayImages,
  );
  if (!input.bedrock) return java;
  // Asset names collide across Projects the same way the Java pack resolves
  // them: the first Project (by id) wins.
  const pngsByName = new Map<string, Uint8Array>();
  for (const a of allAssets) {
    const bytes = glyphPngs.get(a.id);
    if (bytes && !pngsByName.has(a.name)) pngsByName.set(a.name, bytes);
  }
  const bedrock = buildBedrockPack({
    serverId: input.bedrock.serverId,
    menus: bedrockMenus,
    pngs: pngsByName,
    assets: allAssets,
    chestTexture: sources.chest,
  });
  return { ...java, bedrock: { bytes: bedrock.bytes, hash: bedrock.hash } };
}
