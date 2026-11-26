import { sha256Hex } from "@/lib/sha256";
import { type BedrockMenu, bedrockMenusFromProject } from "./bedrock/bedrockMenus";
import { buildBedrockPack } from "./bedrock/bedrockPack";
import { CODEPOINT_MIN } from "./codepoints";
import { packComponents } from "./components";
import { type ComposeRecipe, renderComposed } from "./compose";
import { type DiskAsset, diskAssetsFromTree } from "./diskAssets";
import type { TextUpTexture } from "./fontJsonBuilder";
import { type ImageButtonPlacement, imageButtonsFromMenus } from "./imageButtons";
import { type PixelSize, measuredPaths, pixelSize } from "./imageFunction";
import { ImageNames, namedImageRow, themeImagePath } from "./imageNames";
import {
  KIT_ASCENT,
  KIT_FILES,
  KIT_FOLDER,
  KIT_PREFIX,
  KIT_SLOTS,
  kitFolderAmong,
  kitImage,
  kitNameOf,
  kitShippedName,
  kitShippedPath,
  kitSlot,
} from "./kit";
import {
  type GlyphPlacement,
  glyphPlacementsFromMenus,
  titleImagesFromMenus,
} from "./menuGlyphPlacements";
import { type TextPlacement, textPlacementsFromMenus } from "./menuTextPlacements";
import type { OverlayAsk, OverlayImageRequest } from "./overlayImages";
import { type RgbaImage, encodePng } from "./png";
import { type AssetRow, type BuildResult, buildResourcePackZip } from "./resourcePackBuilder";
import { type GlyphContribution, mergeCodepoints } from "./rpCodepointMerger";
import type { Slice } from "./slice";
import { usedSymbols } from "./symbols";
import { textSheets, usedTextChars } from "./textChars";
import { usesDecorations } from "./textDecorations";
import { readKitThemes } from "./theme";
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
  /** The Project's folder on disk, which names it on the plugin side (Bedrock menu keys, `<folder>:<name>` of an image, `imageNames.ts`); defaults to `id`. */
  folder?: string;
  /**
   * `"theme"`: a folder of `themes/` (the Project roots' `role`). One other than the common
   * images' holds no Document and no image of its own in the pack: it is read as a theme when
   * the server has it in place (`theme.ts`).
   */
  role?: "theme";
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
  /** `resource-pack.themes` from `config.yml`: the themes `kit:` images are shown in, the lowest first (`theme.ts`); one the kit module does not hold is left out. */
  themes?: readonly string[];
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
  const folderOf = (project: PackProject) => project.folder ?? project.id;
  // The common images (`kit.ts`): the server's by name, and the base as the server holds it.
  const kitFolder = kitFolderAmong(input.projects.map(folderOf));
  const inKit = (project: PackProject) => folderOf(project) === kitFolder;
  // The server's themes, each a Project of its name: read when in place, never as a module.
  const isTheme = (project: PackProject) => project.role === "theme" && !inKit(project);
  const themeProjects = new Map(input.projects.filter(isTheme).map((p) => [folderOf(p), p]));
  const projects = input.projects
    .filter((p) => !isTheme(p))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const allAssets: AssetRow[] = [];
  const contribs: GlyphContribution[] = [];
  const glyphPngs = new Map<string, Uint8Array>();
  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();
  // A menu's image names are read with its module's folder, once every module's images are known.
  const names = new ImageNames();
  const placedGlyphs: { folder: string; placement: GlyphPlacement }[] = [];
  const placedButtons: { folder: string; button: ImageButtonPlacement }[] = [];
  const askedOverlays: { folder: string; request: OverlayImageRequest }[] = [];
  const textPlacements: TextPlacement[] = [];
  const transparent = new Set<GuiContainer>();
  const imagesByRef: { ref: string; bytes: Uint8Array }[] = [];
  const texts: string[] = [];
  const titleImages: { folder: string; ref: string }[] = [];
  const kitProject = projects.find(inKit);
  const kitImages = new Map<string, Uint8Array>();
  /** The margins of the server's common images that are sliced (`slice.ts`), by name. */
  const kitSlices = new Map<string, Slice>();
  const kitBase = new Map<string, Uint8Array | null>();
  const kitImageOf = async (name: string) => {
    let base = kitBase.get(name);
    if (base === undefined) {
      const path = kitShippedPath(name);
      base = kitProject?.binaries.some((b) => b.path === path)
        ? ((await kitProject.binary(path)) ?? null)
        : null;
      kitBase.set(name, base);
    }
    return kitImage(name, kitImages.get(name), input.kitImage, base);
  };
  // Whether what the common image `name` shows (`png`) is the server's own image, not the base's.
  const serverOwn = (name: string, png: Uint8Array) => png === kitImages.get(name);
  const composed: {
    /** `null` for a common image, which has no row of its own: it is a `kit:<name>` once named. */
    row: AssetRow | null;
    project: PackProject;
    recipe: ComposeRecipe;
    own: Map<string, Uint8Array>;
    /** The margins of the module's sliced images, by name. */
    slices: Map<string, Slice>;
    /** Its name in its module, which its row's is not once qualified. */
    name: string;
  }[] = [];

  // The common images' names, before any module's image is named (`ImageNames.common`). A
  // server older than the theme `artisan` keeps the ids it had.
  if (kitProject && kitFolder === KIT_FOLDER) {
    for (const a of diskAssetsFromTree(kitProject.id, kitProject.files, kitProject.binaries, {
      originals: false,
    }))
      if (a.row.type === "glyph" || a.row.type === "texture") names.common(a.row.id);
    for (const { path } of kitProject.binaries) {
      const name = kitShippedName(path);
      if (name) names.common(name);
    }
    for (const slot of KIT_SLOTS) names.common(slot.id);
  }

  // The themes in place (`theme.ts`), the lowest first: they redraw the common images they name.
  const theme = input.themes?.length
    ? readKitThemes(input.themes, kitProject, themeProjects)
    : null;

  // A look that names a component is read as that component's parts (`components.ts`).
  const expandOf = packComponents(
    projects.map((project) => ({ folder: folderOf(project), files: project.files })),
  );
  for (const project of projects) {
    const { files } = project;
    const folder = folderOf(project);
    const expand = expandOf(folder);
    // Any text of the Project may reach a title (menus, lang files, data rows): its symbols ride along.
    for (const f of files) texts.push(f.content);
    for (const placement of glyphPlacementsFromMenus(files))
      placedGlyphs.push({ folder, placement });
    for (const ref of titleImagesFromMenus(files)) titleImages.push({ folder, ref });
    for (const button of imageButtonsFromMenus(files, expand))
      placedButtons.push({ folder, button });
    textPlacements.push(...textPlacementsFromMenus(files, expand));
    for (const request of project.overlayImages ?? []) askedOverlays.push({ folder, request });
    for (const c of transparentContainersFromMenus(files)) transparent.add(c);
    // The theme `artisan` holds the common images: one enters the pack as `kit:<name>` when a
    // menu names it, never as an image of the theme's own; its originals are the base.
    const common = folder === KIT_FOLDER;
    // The owner's image of an original that declares a function is taken at its measures only.
    const sizes = new Map<string, PixelSize | null>();
    if (!common)
      for (const path of measuredPaths(files, project.binaries))
        sizes.set(path, pixelSize(await project.binary(path)));
    const fromDisk: DiskAsset[] = diskAssetsFromTree(project.id, files, project.binaries, {
      originals: !common,
      sizeOf: (path) => sizes.get(path) ?? null,
    });

    // An image the module is not the first to hold under that name gets its module's id (`imageNames.ts`).
    const rows = fromDisk.map((a) => {
      const image = a.row.type === "glyph" || a.row.type === "texture";
      if (image && common) return a.row;
      if (image) return namedImageRow(a.row, names.claim(folder, a.row.id), folder);
      names.take(a.row.id);
      return a.row;
    });
    contribs.push({
      projectId: project.id,
      glyphs: rows
        .filter((row) => row.type === "glyph" && row.codepoint !== null && !common)
        .map((row) => ({ assetId: row.id, codepoint: row.codepoint! })),
    });
    // The module's own PNGs by name: what its composed images are made of.
    const own = new Map<string, Uint8Array>();
    const slices = new Map<string, Slice>();
    for (const a of fromDisk) if (a.row.slice && !a.compose) slices.set(a.row.name, a.row.slice);
    for (const [i, a] of fromDisk.entries()) {
      const row = rows[i]!;
      if (common && (row.type === "glyph" || row.type === "texture")) {
        if (a.row.slice) kitSlices.set(a.row.name, a.row.slice);
        if (a.compose) {
          composed.push({
            row: null,
            project,
            recipe: a.compose,
            own,
            slices,
            name: a.row.name,
          });
          continue;
        }
        const bytes = await project.binary(a.path);
        if (!bytes) continue;
        imagesByRef.push({ ref: `${project.id}:${a.row.name}`, bytes });
        own.set(a.row.name, bytes);
        kitImages.set(a.row.name, bytes);
        continue;
      }
      allAssets.push(row);
      if ((row.type === "glyph" && row.codepoint !== null) || row.type === "texture") {
        if (a.compose) {
          composed.push({ row, project, recipe: a.compose, own, slices, name: a.row.name });
          continue;
        }
        // A module's own image is the module's: no theme changes it.
        const bytes = await project.binary(a.path);
        if (!bytes) continue;
        glyphPngs.set(row.id, bytes);
        imagesByRef.push({ ref: `${project.id}:${a.row.name}`, bytes });
        own.set(a.row.name, bytes);
        // A server older than the theme `artisan` keeps its common images in a module.
        if (folder === kitFolder) {
          if (a.row.slice) kitSlices.set(a.row.name, a.row.slice);
          kitImages.set(a.row.name, bytes);
        }
        continue;
      }
      if (row.type !== "font") continue;
      // A font is unpacked on disk: its glyphs are sibling files of the descriptor.
      const meta = row.fontMeta as { glyphMap?: { texture: string }[] } | null;
      const dir = a.path.slice(0, a.path.lastIndexOf("/"));
      const fontMap = new Map<string, Uint8Array>();
      for (const g of meta?.glyphMap ?? []) {
        const bytes = await project.binary(`${dir}/${g.texture}`);
        if (bytes) fontMap.set(g.texture, bytes);
      }
      if (fontMap.size > 0) fontGlyphPngs.set(row.id, fontMap);
    }
  }

  // Composed images (`compose.ts`), once every module's PNGs are read: a layer is a PNG of the
  // module or a kit image, never another composed image, so their order does not matter.
  // The themes in place change the kit's PNGs, the base's and the server's: an image composed
  // with them follows, and is not themed a second time once assembled.
  const kitPng = async (name: string) => {
    const image = await kitImageOf(name);
    if (!image || !theme) return image?.png;
    return theme.shown(name, image.png);
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
      (name) => {
        const common = kitNameOf(name);
        // In the kit module an image is a kit image under its bare name too.
        return common !== null ? kitSlices.get(common) : c.slices.get(name);
      },
    );
    if (image) made.push({ c, image });
  }
  for (const { c, image } of made) {
    const bytes = encodePng(image);
    if (c.row) {
      c.row.width = image.width;
      c.row.height = image.height;
      glyphPngs.set(c.row.id, bytes);
    }
    imagesByRef.push({ ref: `${c.project.id}:${c.name}`, bytes });
    if (inKit(c.project)) kitImages.set(c.name, bytes);
  }

  // A theme's own images (`assets/` of its Project, decision 5): `<theme>:<name>` while the
  // server holds the theme, in place or not. One enters the pack when a menu or a module names
  // it. A theme of a module's name gives none: `<folder>:<name>` is that module's.
  const themeOwn = new Map<string, { project: PackProject; folder: string; asset: DiskAsset }>();
  const moduleFolders = new Set(projects.map(folderOf));
  for (const folder of [...themeProjects.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (moduleFolders.has(folder)) continue;
    const project = themeProjects.get(folder)!;
    for (const asset of diskAssetsFromTree(project.id, project.files, project.binaries, {
      originals: false,
    })) {
      if (asset.compose || (asset.row.type !== "glyph" && asset.row.type !== "texture")) continue;
      const id = names.themeOwn(folder, asset.row.name);
      if (id) themeOwn.set(id, { project, folder, asset });
    }
  }

  // A name no module holds reaches the common image of that name (`resolveImageRef`).
  for (const name of kitImages.keys()) names.take(KIT_PREFIX + name);
  for (const { path } of kitProject?.binaries ?? []) {
    const name = kitShippedName(path);
    if (name) names.take(KIT_PREFIX + name);
  }
  for (const slot of KIT_SLOTS) names.take(KIT_PREFIX + slot.id);

  const glyphPlacements = placedGlyphs.map(({ folder, placement }) => ({
    ...placement,
    assetId: names.resolve(folder, placement.assetId),
  }));
  const imageButtons = placedButtons.map(({ folder, button }) => ({
    ...button,
    asset: names.resolve(folder, button.asset),
  }));
  // The plugin asks for a module's image by its name alone (`OverlayApi.image`): the key keeps
  // the name, the picture is the asking module's own.
  const overlayImages: OverlayAsk[] = askedOverlays.map(({ folder, request }) => ({
    ...request,
    image: names.resolve(folder, request.asset),
  }));

  // `kit:<name>` (`kit.ts`): only the ones a menu or a module asks for, so a server that names
  // none keeps the pack it had. One a title is drawn with is a glyph of the menu font, at the
  // first codepoint no module's glyph has; the others are textures.
  const inTitles = new Set<string>();
  for (const { folder, ref } of titleImages) {
    const name = kitNameOf(names.resolve(folder, ref));
    if (name) inTitles.add(name);
  }
  const asked = new Set(inTitles);
  for (const asset of [...imageButtons.map((b) => b.asset), ...overlayImages.map((o) => o.image)]) {
    const name = asset === undefined ? null : kitNameOf(asset);
    if (name) asked.add(name);
  }
  const kitGlyphs: GlyphContribution["glyphs"] = [];
  for (const name of [...asked].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const image = await kitImageOf(name);
    if (!image) continue;
    const png = theme ? await theme.shown(name, image.png) : image.png;
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
      // The margins the server's common image declares, else the ones of the base's own drawing.
      ...(kitSlices.has(name)
        ? { slice: kitSlices.get(name)! }
        : !serverOwn(name, image.png) && kitSlot(name)?.slice
          ? { slice: kitSlot(name)!.slice! }
          : {}),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    if (glyph) kitGlyphs.push({ assetId: id, codepoint: CODEPOINT_MIN });
    glyphPngs.set(id, png);
  }
  if (kitGlyphs.length > 0) contribs.push({ projectId: KIT_FOLDER, glyphs: kitGlyphs });

  // The themes' own images that are named, as their files are: a glyph keeps its descriptor,
  // and its codepoint comes after the modules' and the common images'.
  const namedOwn = new Set<string>();
  for (const id of [
    ...glyphPlacements.map((p) => p.assetId),
    ...titleImages.map(({ folder, ref }) => names.resolve(folder, ref)),
    ...imageButtons.map((b) => b.asset),
    ...overlayImages.map((o) => o.image),
  ])
    if (id !== undefined && themeOwn.has(id)) namedOwn.add(id);
  const themeGlyphs = new Map<string, GlyphContribution["glyphs"]>();
  for (const id of [...namedOwn].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const { project, folder, asset } = themeOwn.get(id)!;
    const row = { ...asset.row, id, name: themeImagePath(folder, asset.row.name) };
    allAssets.push(row);
    // As a module's: a glyph without a codepoint is in the index, and no PNG of the pack.
    if (row.type === "glyph" && row.codepoint === null) continue;
    const bytes = await project.binary(asset.path);
    if (!bytes) continue;
    glyphPngs.set(id, bytes);
    if (row.type === "glyph" && row.codepoint !== null) {
      const glyphs = themeGlyphs.get(project.id) ?? [];
      glyphs.push({ assetId: id, codepoint: row.codepoint });
      themeGlyphs.set(project.id, glyphs);
    }
  }
  for (const [projectId, glyphs] of themeGlyphs) contribs.push({ projectId, glyphs });

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
  // Keyed by the folder name: the plugin names a menu's Project that way.
  const bedrockMenus: BedrockMenu[] = projects.flatMap((project) => {
    const folder = folderOf(project);
    return bedrockMenusFromProject(
      folder,
      project.files,
      (ref) => names.resolve(folder, ref),
      expandOf(folder),
    );
  });
  const bedrock = buildBedrockPack({
    serverId: input.bedrock.serverId,
    menus: bedrockMenus,
    pngs: pngsByName,
    assets: allAssets,
    chestTexture: sources.chest,
  });
  return { ...java, bedrock: { bytes: bedrock.bytes, hash: bedrock.hash } };
}
