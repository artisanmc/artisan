import { sha256Hex } from "@/lib/sha256";
import { type BedrockMenu, bedrockMenusFromProject } from "./bedrock/bedrockMenus";
import { buildBedrockPack } from "./bedrock/bedrockPack";
import { CODEPOINT_MIN } from "./codepoints";
import { type ComposeRecipe, renderComposed } from "./compose";
import { type DiskAsset, diskAssetsFromTree } from "./diskAssets";
import type { TextUpTexture } from "./fontJsonBuilder";
import { type ImageButtonPlacement, imageButtonsFromMenus } from "./imageButtons";
import { KIT_ASCENT, KIT_FILES, KIT_FOLDER, KIT_PREFIX, kitImage, kitNameOf } from "./kit";
import { readKitTheme } from "./theme";
import {
  type GlyphPlacement,
  glyphPlacementsFromMenus,
  titleImagesFromMenus,
} from "./menuGlyphPlacements";
import { type TextPlacement, textPlacementsFromMenus } from "./menuTextPlacements";
import type { OverlayImageRequest } from "./overlayImages";
import { type RgbaImage, encodePng } from "./png";
import { type AssetRow, type BuildResult, buildResourcePackZip } from "./resourcePackBuilder";
import { type GlyphContribution, mergeCodepoints } from "./rpCodepointMerger";
import { usedSymbols } from "./symbols";
import { textSheets, usedTextChars } from "./textChars";
import { usesDecorations } from "./textDecorations";
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
  /** The PNG Artisan ships for a slot of the UI kit's base (`kit.ts`), read only when a menu names it. */
  kitImage(id: string): Promise<Uint8Array>;
  /** Redraw the containers a menu makes transparent (`vanilla_gui_v1`); true for every current plugin. */
  transparentContainers?: boolean;
  /** `resource-pack.hide-inventory-label` from `config.yml`: empty the client's "Inventory" label. */
  hideInventoryLabel?: boolean;
  /** `resource-pack.theme` from `config.yml`: the kit's theme `kit:` images are shown in (`theme.ts`); absent, or one the kit module does not hold: none. */
  theme?: string;
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
  const textPlacements: TextPlacement[] = [];
  const transparent = new Set<GuiContainer>();
  const imagesByRef: { ref: string; bytes: Uint8Array }[] = [];
  const overlayImages: OverlayImageRequest[] = [];
  const bedrockMenus: BedrockMenu[] = [];
  const texts: string[] = [];
  const titleImages: string[] = [];
  const kitImages = new Map<string, Uint8Array>();
  const composed: {
    row: AssetRow;
    project: PackProject;
    recipe: ComposeRecipe;
    own: Map<string, Uint8Array>;
  }[] = [];

  for (const project of projects) {
    const { files } = project;
    // Any text of the Project may reach a title (menus, lang files, data rows): its symbols ride along.
    for (const f of files) texts.push(f.content);
    glyphPlacements.push(...glyphPlacementsFromMenus(files));
    titleImages.push(...titleImagesFromMenus(files));
    imageButtons.push(...imageButtonsFromMenus(files));
    textPlacements.push(...textPlacementsFromMenus(files));
    overlayImages.push(...(project.overlayImages ?? []));
    for (const c of transparentContainersFromMenus(files)) transparent.add(c);
    // Keyed by the folder name: the plugin names a menu's Project that way.
    if (input.bedrock)
      bedrockMenus.push(...bedrockMenusFromProject(project.folder ?? project.id, files));
    const fromDisk: DiskAsset[] = diskAssetsFromTree(project.id, files, project.binaries, {
      originals: true,
    });

    contribs.push({
      projectId: project.id,
      glyphs: fromDisk
        .filter((a) => a.row.type === "glyph" && a.row.codepoint !== null)
        .map((a) => ({ assetId: a.row.id, codepoint: a.row.codepoint! })),
    });
    // The module's own PNGs by name: what its composed images are made of.
    const own = new Map<string, Uint8Array>();
    for (const a of fromDisk) {
      allAssets.push(a.row);
      if ((a.row.type === "glyph" && a.row.codepoint !== null) || a.row.type === "texture") {
        if (a.compose) {
          composed.push({ row: a.row, project, recipe: a.compose, own });
          continue;
        }
        const bytes = await project.binary(a.path);
        if (!bytes) continue;
        glyphPngs.set(a.row.id, bytes);
        imagesByRef.push({ ref: `${project.id}:${a.row.name}`, bytes });
        own.set(a.row.name, bytes);
        if ((project.folder ?? project.id) === KIT_FOLDER) kitImages.set(a.row.name, bytes);
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

  // Composed images (`compose.ts`), once every module's PNGs are read: a layer is a PNG of the
  // module or a kit image, never another composed image, so their order does not matter.
  // The kit's theme (`theme.ts`) changes the kit's PNGs, the base's and the server's: an image
  // composed with them follows, and is not themed a second time once assembled.
  const inKit = (project: PackProject) => (project.folder ?? project.id) === KIT_FOLDER;
  const kitProject = input.theme ? projects.find(inKit) : undefined;
  const theme = input.theme && kitProject ? readKitTheme(input.theme, kitProject) : null;
  const kitPng = async (name: string) => {
    const png = (await kitImage(name, kitImages.get(name), input.kitImage))?.png;
    return png && theme ? theme.shown(name, png) : png;
  };
  const made: { c: (typeof composed)[number]; image: RgbaImage }[] = [];
  for (const c of composed) {
    const image = await renderComposed(
      c.recipe,
      // In the kit module an image is a kit image under its bare name too.
      (name) => {
        const png = c.own.get(name);
        return png && theme && inKit(c.project) ? theme.shown(name, png) : png;
      },
      kitPng,
    );
    if (image) made.push({ c, image });
  }
  const kitComposed = new Set<string>();
  for (const { c, image } of made) {
    c.row.width = image.width;
    c.row.height = image.height;
    const bytes = encodePng(image);
    glyphPngs.set(c.row.id, bytes);
    imagesByRef.push({ ref: `${c.project.id}:${c.row.name}`, bytes });
    if (inKit(c.project)) {
      kitImages.set(c.row.name, bytes);
      kitComposed.add(c.row.name);
    }
  }

  // `kit:<name>` (`kit.ts`): only the ones a menu or a module asks for, so a server that names
  // none keeps the pack it had. One a title is drawn with is a glyph of the menu font, at the
  // first codepoint no module's glyph has; the others are textures.
  const inTitles = new Set<string>();
  for (const asset of titleImages) {
    const name = kitNameOf(asset);
    if (name) inTitles.add(name);
  }
  const asked = new Set(inTitles);
  for (const { asset } of [...imageButtons, ...overlayImages]) {
    const name = kitNameOf(asset);
    if (name) asked.add(name);
  }
  const kitGlyphs: GlyphContribution["glyphs"] = [];
  for (const name of [...asked].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const image = await kitImage(name, kitImages.get(name), input.kitImage);
    if (!image) continue;
    const png = !theme
      ? image.png
      : // Assembled from themed layers already: only the theme's own drawing of it replaces it.
        image.png === kitImages.get(name) && kitComposed.has(name)
        ? ((await theme.drawing(name, image.png)) ?? image.png)
        : await theme.shown(name, image.png);
    const id = KIT_PREFIX + name;
    const glyph = inTitles.has(name);
    allAssets.push({
      id,
      projectId: KIT_FOLDER,
      type: glyph ? "glyph" : "texture",
      name: KIT_FILES + name,
      width: image.width,
      height: image.height,
      ascent: glyph ? KIT_ASCENT : null,
      codepoint: glyph ? CODEPOINT_MIN : null,
      contentWidth: null,
      fontMeta: null,
      contentHash: sha256Hex(png),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    if (glyph) kitGlyphs.push({ assetId: id, codepoint: CODEPOINT_MIN });
    glyphPngs.set(id, png);
  }
  if (kitGlyphs.length > 0) contribs.push({ projectId: KIT_FOLDER, glyphs: kitGlyphs });

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
    input.hideInventoryLabel === true,
    usedSymbols(texts),
    textPlacements,
    usesDecorations(texts),
    textSheets(usedTextChars(texts)),
  );
  if (!input.bedrock) return java;
  // Asset names collide across Projects the same way the Java pack resolves
  // them: the first Project (by id) wins.
  const pngsByName = new Map<string, Uint8Array>();
  for (const a of allAssets) {
    const bytes = glyphPngs.get(a.id);
    // By id, what a menu writes: a file's name, `kit:<name>` for a kit image.
    if (bytes && !pngsByName.has(a.id)) pngsByName.set(a.id, bytes);
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
