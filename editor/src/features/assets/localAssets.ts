import type { Asset, AssetType } from "@/domain/asset";
import type { ProjectDraft } from "@/features/project/draft";
import type { AssetMutation } from "@/features/project/persistedDrafts";
import { apiRequest } from "@/lib/api/client";
import {
  DraftApiError,
  type PersistedDraft,
  readDraft,
  readDraftBlob,
  updateDraft,
  uploadDraftBlob,
} from "@/lib/api/projectDrafts";
import { readProjectFiles } from "@/lib/api/projectFiles";
import { readVersionBinary } from "@/lib/api/projectVersions";
import {
  type DiskAssetDescriptor,
  type DiskAssetsTree,
  assetDiskPath,
  assetFileName,
  descriptorOf,
  descriptorPath,
  descriptorYaml,
  nextFreeCodepoint,
} from "@/lib/pack/assetDiskWrite";
import { type AssetUsage, parseAssetUsages } from "@/lib/pack/assetUsages";
import { type ComposeRecipe, composeRecipe, composeYaml } from "@/lib/pack/compose";
import { type DiskAsset, diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { FONT_DESCRIPTOR, fontDir, fontFilesFor, fontFromDisk } from "@/lib/pack/fontOnDisk";
import { imageFunctionOf } from "@/lib/pack/imageFunction";
import { isKitFolder, kitSlot } from "@/lib/pack/kit";
import { type ParsedMcFont, parseMcFontsZip } from "@/lib/pack/mcFontsParser";
import { readPngContentWidth, readPngDimensions } from "@/lib/pack/pngDimensions";
import type { AssetRow } from "@/lib/pack/resourcePackBuilder";
import { type Slice, sliceOf } from "@/lib/pack/slice";
import { sha256Hex } from "@/lib/sha256";
import { useKitStore } from "@/state/kitStore";
import { useProjectsStore } from "@/state/projectsStore";
import { parse, stringify } from "yaml";
import { type ComposedView, composedView } from "./composedAssets";
import { activeKitTheme } from "./kitTheme";

/**
 * A Project's assets: the editor validates and stores them itself, on the
 * private draft (snapshot + blobs) the plugin already keeps.
 */

const NAME_RE = /^[a-z0-9_-]+$/;

/** Whether `projectId` holds the server's common images (the theme `artisan`), published or still a draft. */
export function isKitModule(projectId: string): boolean {
  if (useKitStore.getState().read?.projectId === projectId) return true;
  const open = useProjectsStore.getState().openProjects.projects.find((p) => p.id === projectId);
  return !!open && isKitFolder(open.diskId ?? open.id);
}
const MAX_RAW_BYTES = 2 * 1024 * 1024;
const MAX_FONT_BYTES = 5 * 1024 * 1024;
const WRITE_ERRORS = [
  "draft_conflict",
  "operation_mismatch",
  "operation_conflict",
  "operation_expired",
  "invalid_draft",
  "invalid_blob",
  "draft_not_active",
  "owner_revoked",
];

type Tree = { path: string; content: string }[];
type Binaries = { path: string; hash: string; size: number }[];
interface WriteBatch {
  files: { path: string; content: string; base_hash: string | null }[];
  binaries: { path: string; content: Uint8Array | null; baseHash: string | null }[];
  deletes?: { path: string; base_hash: string | null }[];
}
export interface LocalAssetResult {
  draft: PersistedDraft;
  asset?: Asset;
  warnings?: string[];
}

const textHash = (content: string) => sha256Hex(new TextEncoder().encode(content));
function fail(status: number, error: string, draft?: PersistedDraft): never {
  throw new DraftApiError(error, status, draft);
}

/** The fields of an asset JSON request, typed as the client sends them. */
export function assetJsonFields(fields: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      key === "usages" || key === "compose" || key === "slice"
        ? JSON.parse(value)
        : ["height", "ascent"].includes(key)
          ? Number(value)
          : value,
    ]),
  );
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function serialize(row: AssetRow): Asset {
  return JSON.parse(
    JSON.stringify({
      id: row.id,
      projectId: row.projectId,
      type: row.type,
      name: row.name,
      width: row.width,
      height: row.height,
      ascent: row.ascent,
      codepoint: row.codepoint,
      fontMeta: row.fontMeta,
      usages: row.usages,
      function: row.function,
      slice: row.slice,
      contentHash: row.contentHash,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  ) as Asset;
}

/**
 * The PNG of the server's kit module named `name`, as published: what a `kit:<name>` layer of a
 * composed image is drawn with (`undefined`: the base's stands in). `own` answers for the kit
 * module itself, whose images are the ones being read.
 */
function kitOwn(
  projectId: string,
  own: (name: string) => Promise<Uint8Array | null | undefined>,
): (name: string) => Promise<Uint8Array | null | undefined> {
  const kit = useKitStore.getState().read;
  if (!kit) return async () => undefined;
  if (kit.projectId === projectId) return own;
  return async (name) => {
    // A texture after a glyph of the same name, as the pack reads them: it wins.
    const path = ["assets/textures", "assets/glyphs"]
      .map((dir) => `${dir}/${name}.png`)
      .find((p) => kit.binaries.some((b) => b.path === p));
    return path ? readPublishedBinary(kit.projectId, path).catch(() => null) : undefined;
  };
}

/**
 * The margins of the server's own common image `name`, as published (`slice` in its
 * descriptor). `own` answers for the kit module itself.
 */
function kitOwnSlice(
  projectId: string,
  own: (name: string) => Slice | undefined,
): (name: string) => Slice | undefined {
  const kit = useKitStore.getState().read;
  if (!kit) return () => undefined;
  if (kit.projectId === projectId) return own;
  return (name) => {
    const stem = ["assets/textures", "assets/glyphs"]
      .map((dir) => `${dir}/${name}`)
      .find((p) => kit.binaries.some((b) => b.path === `${p}.png`));
    if (!stem) return undefined;
    try {
      return (
        sliceOf(parse(kit.files[`${stem}.yml`] ?? kit.files[`${stem}.yaml`] ?? "")) ?? undefined
      );
    } catch {
      return undefined;
    }
  };
}

/** The pictures of `disk`'s composed images, by asset: assembled as the pack does it. */
async function composedViews(
  projectId: string,
  disk: DiskAsset[],
  bytes: (asset: DiskAsset) => Promise<Uint8Array | null>,
): Promise<Map<DiskAsset, ComposedView>> {
  const out = new Map<DiskAsset, ComposedView>();
  const cache = new Map<DiskAsset, Promise<Uint8Array | null>>();
  const read = (asset: DiskAsset) => {
    if (!cache.has(asset))
      cache.set(
        asset,
        bytes(asset).catch(() => null),
      );
    return cache.get(asset)!;
  };
  const kit = kitOwn(projectId, async (name) => {
    const own = disk.find((a) => !a.compose && a.row.type !== "font" && a.row.name === name);
    return own ? read(own) : undefined;
  });
  const kitSlice = kitOwnSlice(
    projectId,
    (name) =>
      disk.find((a) => !a.compose && a.row.type !== "font" && a.row.name === name)?.row.slice,
  );
  // The server's theme: the `kit:` layers are shown in it, and the kit module's own images too.
  const theme = activeKitTheme(readPublishedBinary);
  const inKit = useKitStore.getState().read?.projectId === projectId;
  for (const asset of disk) {
    if (!asset.compose) continue;
    const view = await composedView(asset, disk, read, kit, theme, inKit, kitSlice).catch(
      () => null,
    );
    if (view) out.set(asset, view);
  }
  return out;
}

/**
 * List: the server draft's snapshot if there is one, otherwise the published disk.
 * `composed: false` leaves the composed images out: a caller that copies assets elsewhere
 * cannot take one without its layers.
 */
export async function listLocalAssets(
  projectId: string,
  filters: { type?: AssetType; search?: string; composed?: boolean },
  draftId?: string,
): Promise<Asset[]> {
  let files: Tree;
  let binaries: Binaries;
  let baseline: Record<string, { hash: string }> | null = null;
  if (draftId) {
    const { snapshot } = await readDraft(projectId, draftId);
    files = Object.entries(snapshot.tree).map(([path, content]) => ({ path, content }));
    binaries = Object.entries(snapshot.binaryTree ?? {}).map(([path, meta]) => ({ path, ...meta }));
    baseline = snapshot.binaryBaseline ?? {};
  } else {
    const read = await readProjectFiles(projectId);
    if (!read.ok || read.unchanged) throw new Error("Failed to load assets");
    files = Object.entries(read.files).map(([path, content]) => ({ path, content }));
    binaries = read.binaries ?? [];
  }
  // What the module ships (`originals/assets/…`) is listed too, read-only: menus and module
  // previews pick their images here. Changes go through the owner's files alone (`DraftOverlay`).
  const disk = diskAssetsFromTree(projectId, files, binaries, { originals: true });
  const listed = disk
    .filter((a) => filters.composed !== false || !a.compose)
    .filter((a) => !filters.type || a.row.type === filters.type)
    .filter(
      (a) => !filters.search || a.row.name.toLowerCase().includes(filters.search.toLowerCase()),
    );
  if (!listed.some((a) => a.compose)) return listed.map((a) => serialize(a.row));
  // A layer's PNG: the draft's blob when it changed there, the published file otherwise.
  const views = await composedViews(projectId, disk, async (asset) => {
    if (draftId && baseline && baseline[asset.path]?.hash !== asset.hash)
      return readDraftBlob(projectId, draftId, asset.hash);
    return readPublishedBinary(projectId, asset.path);
  });
  return listed.map((a) => ({ ...serialize(a.row), ...views.get(a) }));
}

/** A published binary of a Project, `null` when the disk does not have it. */
export async function readPublishedBinary(
  projectId: string,
  path: string,
): Promise<Uint8Array | null> {
  const response = await apiRequest(
    `/api/v1/projects/${encodeURIComponent(projectId)}/binary?path=${encodeURIComponent(path)}`,
  ).catch(() => fail(503, "storage_unavailable"));
  if (response.status === 404 || response.status === 422) return null;
  if (!response.ok) fail(503, "storage_unavailable");
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The files of one asset, read where `listLocalAssets` read it: the Project's
 * draft when there is one, otherwise its published disk. A font brings its
 * descriptor and every glyph PNG; an image brings its PNG and its descriptor.
 * `path` is relative to the asset's folder, so the copy can land under another name.
 */
export interface AssetFiles {
  type: AssetType;
  name: string;
  descriptor: string | null;
  binaries: { path: string; bytes: Uint8Array }[];
}

export async function readAssetFiles(
  projectId: string,
  asset: Pick<Asset, "id" | "type">,
  draftId?: string,
): Promise<AssetFiles> {
  let files: Tree;
  let binaries: Binaries;
  let baseline: Record<string, { hash: string }> = {};
  if (draftId) {
    const { snapshot } = await readDraft(projectId, draftId);
    files = Object.entries(snapshot.tree).map(([path, content]) => ({ path, content }));
    binaries = Object.entries(snapshot.binaryTree ?? {}).map(([path, meta]) => ({ path, ...meta }));
    baseline = snapshot.binaryBaseline ?? {};
  } else {
    const read = await readProjectFiles(projectId);
    if (!read.ok || read.unchanged) fail(503, "storage_unavailable");
    files = Object.entries(read.files).map(([path, content]) => ({ path, content }));
    binaries = read.binaries ?? [];
  }
  const found =
    diskAssetsFromTree(projectId, files, binaries, { originals: true }).find(
      (a) => a.row.id === asset.id && a.row.type === asset.type,
    ) ?? fail(404, "not_found");
  const bytesOf = async (path: string, hash: string): Promise<Uint8Array> => {
    let content: Uint8Array | null = null;
    if (draftId && baseline[path]?.hash !== hash)
      content = await readDraftBlob(projectId, draftId, hash).catch(() => null);
    content ??= await readPublishedBinary(projectId, path);
    if (!content || sha256Hex(content) !== hash) fail(503, "storage_unavailable");
    return content;
  };
  if (found.row.type === "font") {
    const dir = found.path.slice(0, found.path.lastIndexOf("/"));
    const meta = found.row.fontMeta as { glyphMap?: { texture: string }[] } | null;
    const out: AssetFiles["binaries"] = [];
    for (const texture of new Set((meta?.glyphMap ?? []).map((g) => g.texture))) {
      const bin = binaries.find((b) => b.path === `${dir}/${texture}`);
      if (bin) out.push({ path: texture, bytes: await bytesOf(bin.path, bin.hash) });
    }
    const descriptor = files.find((f) => f.path === found.path)?.content ?? null;
    return { type: "font", name: found.row.name, descriptor, binaries: out };
  }
  // Without its layers, which stay in this Project, a composed image would be an empty one there.
  if (found.compose) fail(400, "A composed image cannot be copied to another module");
  const descriptor = descriptorOf(files, found.path)?.content ?? null;
  return {
    type: found.row.type as AssetType,
    name: found.row.name,
    descriptor,
    binaries: [{ path: "", bytes: await bytesOf(found.path, found.hash) }],
  };
}

/** `name`, or `name_2`, `name_3`… the first that no asset of the Project holds. */
export function freeAssetName(name: string, taken: Iterable<string>): string {
  const ids = new Set(taken);
  if (!ids.has(assetFileName(name))) return name;
  let n = 2;
  while (ids.has(assetFileName(`${name}_${n}`))) n++;
  return `${name}_${n}`;
}

/** Browser-side `DraftAssetStorage`: reads the frozen snapshot, writes blobs then a revision. */
class DraftOverlay {
  updatedDraft?: PersistedDraft;
  constructor(
    private readonly projectId: string,
    private readonly operation: AssetMutation,
  ) {}
  private get snapshot(): ProjectDraft {
    return this.operation.snapshot!;
  }

  read(): DiskAssetsTree {
    const files = Object.entries(this.snapshot.tree).map(([path, content]) => ({ path, content }));
    const binaries = Object.entries(this.snapshot.binaryTree ?? {}).map(([path, meta]) => ({
      path,
      ...meta,
    }));
    return { files, binaries, assets: diskAssetsFromTree(this.projectId, files, binaries) };
  }

  /**
   * The image `id` as its module ships it (`originals/…`), when the owner holds none of that
   * name: what a first retouch draws the owner's version over.
   */
  shipped(disk: DiskAssetsTree, type: string, id: string): DiskAsset | undefined {
    return diskAssetsFromTree(this.projectId, disk.files, disk.binaries, { originals: true }).find(
      (a) => a.row.type === type && a.row.id === id && a.path.startsWith("originals/"),
    );
  }

  /** Verified bytes of an asset: published if unchanged, otherwise the draft blob. */
  async bytes(asset: DiskAsset): Promise<Uint8Array | null> {
    const meta = this.snapshot.binaryTree?.[asset.path];
    if (!meta) return null;
    let content: Uint8Array | null = null;
    if (this.snapshot.binaryBaseline?.[asset.path]?.hash === meta.hash) {
      content = await this.published(asset.path);
      if (content && sha256Hex(content) !== meta.hash) content = null;
    }
    if (!content) {
      try {
        content = await readDraftBlob(this.projectId, this.operation.id, meta.hash);
      } catch (error) {
        if (!(error instanceof DraftApiError) || ![404, 422].includes(error.status))
          fail(503, "storage_unavailable");
        content = await this.published(asset.path);
        if (!content) return null;
      }
    }
    if (sha256Hex(content) !== asset.hash) fail(503, "storage_unavailable");
    return content;
  }

  private published(path: string): Promise<Uint8Array | null> {
    return readPublishedBinary(this.projectId, path);
  }

  /** What the composed image `asset` shows, from the draft's files: one of `disk`, or one about to be. */
  async view(disk: DiskAssetsTree, asset: DiskAsset): Promise<ComposedView | undefined> {
    const all = disk.assets.includes(asset) ? disk.assets : [...disk.assets, asset];
    return (await composedViews(this.projectId, all, (layer) => this.bytes(layer))).get(asset);
  }

  /** All or nothing: base hashes checked, blobs written, then a single revision. */
  async commit(batch: WriteBatch): Promise<void> {
    const { id, revision, name, operationId } = this.operation;
    const next = structuredClone(this.snapshot);
    next.binaryTree ??= {};
    const binaryTree = next.binaryTree;
    for (const f of [...batch.files, ...(batch.deletes ?? [])]) {
      const current = next.tree[f.path];
      if ((current === undefined ? null : textHash(current)) !== f.base_hash) fail(409, "conflict");
    }
    for (const b of batch.binaries)
      if ((binaryTree[b.path]?.hash ?? null) !== b.baseHash) fail(409, "conflict");
    for (const f of batch.files) next.tree[f.path] = f.content;
    for (const d of batch.deletes ?? []) delete next.tree[d.path];
    try {
      for (const b of batch.binaries) {
        if (b.content === null) {
          delete binaryTree[b.path];
          continue;
        }
        const digest = sha256Hex(b.content);
        await uploadDraftBlob(
          this.projectId,
          id,
          revision,
          digest,
          toBase64(b.content),
          textHash(`${operationId}:${digest}`),
        );
        binaryTree[b.path] = { hash: digest, size: b.content.length };
      }
      this.updatedDraft = await updateDraft(this.projectId, id, revision, name, next, operationId);
    } catch (error) {
      if (
        !(error instanceof DraftApiError) ||
        ["server_offline", "fetch_timeout"].includes(error.code)
      )
        fail(503, "server_offline");
      const code = WRITE_ERRORS.includes(error.code) ? error.code : "write_error";
      const status = [
        "draft_conflict",
        "operation_mismatch",
        "operation_conflict",
        "operation_expired",
      ].includes(code)
        ? 409
        : /invalid/.test(code)
          ? 422
          : 503;
      fail(status, code, error.draft);
    }
  }

  writeAsset(
    input: {
      type: string;
      name: string;
      bytes: Uint8Array;
      descriptor: DiskAssetDescriptor;
      baseHash: string | null;
      /** The descriptor on disk this write replaces, when there is one (`descriptorOf`). */
      previous?: { path: string; hash: string };
    },
    remove?: { path: string; hash: string; descriptor: { path: string; hash: string } | null },
  ) {
    const path = assetDiskPath(input.type, input.name);
    return this.commit({
      files: [
        {
          path: input.previous?.path ?? descriptorPath(path),
          content: descriptorYaml(input.descriptor),
          base_hash: input.previous?.hash ?? null,
        },
      ],
      binaries: [
        { path, content: input.bytes, baseHash: input.baseHash },
        ...(remove ? [{ path: remove.path, content: null, baseHash: remove.hash }] : []),
      ],
      deletes: remove?.descriptor
        ? [{ path: remove.descriptor.path, base_hash: remove.descriptor.hash }]
        : [],
    });
  }
}

type Body = Omit<LocalAssetResult, "draft">;

async function create(
  overlay: DraftOverlay,
  projectId: string,
  fields: Record<string, string>,
  file: Uint8Array | null,
): Promise<Body> {
  const type = fields.type ?? "";
  const name = fields.name ?? "";
  const ascentRaw = fields.ascent ?? null;
  if (!["texture", "glyph", "font"].includes(type))
    fail(400, "Invalid type (must be texture, glyph, or font)");
  // In the kit module, an image named as a slot of the base replaces it on this server.
  if (!NAME_RE.test(name) && !(isKitModule(projectId) && kitSlot(name)))
    fail(400, "Invalid name (must match [a-z0-9_-]+)");
  let usages: AssetUsage[] | undefined;
  if (fields.usages !== undefined) {
    try {
      usages = parseAssetUsages(JSON.parse(fields.usages));
    } catch {
      fail(400, "Invalid usages");
    }
    if (type === "font" || usages === undefined)
      fail(400, "Invalid usages (images only; button, menu)");
  }
  if (fields.compose !== undefined) {
    // A composed image: a descriptor that holds its recipe, and no file.
    if (type === "font") fail(400, "Invalid type (a composed image is a texture or a glyph)");
    let recipe: ComposeRecipe;
    try {
      recipe = requestedRecipe(JSON.parse(fields.compose));
    } catch (error) {
      if (error instanceof DraftApiError) throw error;
      fail(400, "Invalid compose");
    }
    const disk = overlay.read();
    const id = assetFileName(name);
    if (disk.assets.some((a) => a.row.id === id)) fail(409, "Asset name already exists");
    const ascent = type === "glyph" ? Number.parseInt(ascentRaw ?? "8", 10) : null;
    if (ascent !== null && !Number.isFinite(ascent)) fail(400, "Invalid ascent");
    const codepoint = type === "glyph" ? nextFreeCodepoint(disk.assets) : null;
    const path = descriptorPath(assetDiskPath(type, name));
    const content = stringify({
      ...(ascent === null ? {} : { ascent }),
      ...(codepoint === null ? {} : { codepoint }),
      usages,
      ...recipeFields(recipe),
    });
    await overlay.commit({ files: [{ path, content, base_hash: null }], binaries: [] });
    const made = diskAssetsFromTree(projectId, [{ path, content }], [])[0]!;
    return { asset: { ...serialize(made.row), ...(await overlay.view(disk, made)) } };
  }
  if (!file) fail(400, "Missing file");
  if (file.length > (type === "font" ? MAX_FONT_BYTES : MAX_RAW_BYTES))
    fail(400, `File too large (max ${type === "font" ? 5 : 2} MB)`);

  let width = 0;
  let height = 0;
  let contentWidth: number | null = null;
  let parsedFont: ParsedMcFont | null = null;
  if (type === "font") {
    try {
      parsedFont = parseMcFontsZip(file);
    } catch (err) {
      fail(400, `Invalid font zip: ${(err as Error).message}`);
    }
    if (parsedFont.glyphMap.length === 0) fail(400, "Empty font (no usable glyphs)");
  } else {
    try {
      ({ width, height } = readPngDimensions(file));
    } catch {
      fail(400, "Invalid PNG");
    }
    contentWidth = readPngContentWidth(file);
  }
  const now = new Date().toISOString();
  const disk = overlay.read();

  // Unpacked font: one PNG per glyph plus its descriptor, in one revision.
  if (parsedFont) {
    if (disk.assets.some((a) => a.row.type === "font" && a.row.id === assetFileName(name)))
      fail(409, "Asset name already exists");
    const { binaries, descriptor } = fontFilesFor(name, parsedFont);
    await overlay.commit({
      files: [{ path: descriptor.path, content: descriptor.content, base_hash: null }],
      binaries: binaries.map((b) => ({ path: b.path, content: b.bytes, baseHash: null })),
    });
    return {
      asset: {
        id: assetFileName(name),
        projectId,
        type: "font",
        name,
        width: 0,
        height: 0,
        ascent: null,
        codepoint: null,
        fontMeta: fontFromDisk(descriptor.content),
        contentHash: textHash(descriptor.content),
        createdAt: now,
        updatedAt: now,
      },
      ...(parsedFont.warnings.length > 0 ? { warnings: parsedFont.warnings } : {}),
    };
  }

  const path = assetDiskPath(type, name);
  // A composed image of that name has no PNG to replace: its recipe would be shadowed.
  if (disk.assets.some((a) => a.compose && a.row.type === type && a.row.id === assetFileName(name)))
    fail(409, "Asset name already exists");
  const existingSame = disk.assets.find((a) => a.path === path);
  // `replace` = reimport: new pixels, same codepoint/ascent/usages.
  // `retouch` = the same image with other pixels (the pixel editor): it also keeps its size.
  const retouch = fields.retouch === "true";
  const replace = retouch || fields.replace === "true";
  if (existingSame && !replace) fail(409, "Asset name already exists");
  // A retouch of an image the module ships and the owner does not hold: the owner's version
  // is written beside the original, with what the original says of itself.
  const source =
    existingSame ?? (retouch ? overlay.shipped(disk, type, assetFileName(name)) : undefined);
  if (!source && replace) fail(404, "not_found");
  const kept = source?.row;
  if (retouch && source && kept) {
    const before = await overlay.bytes(source);
    if (!before) fail(503, "server_offline");
    let drawn = { width: 0, height: 0 };
    try {
      drawn = readPngDimensions(before);
    } catch {
      // An unreadable file has no size to keep: refused below.
    }
    if (drawn.width !== width || drawn.height !== height)
      fail(400, "A retouch keeps the image's size");
    // A glyph shown at another height than its file's stays at that height.
    if (kept.width > 0 && kept.height > 0 && kept.height !== height) {
      if (typeof contentWidth === "number" && contentWidth > 0)
        contentWidth = Math.max(1, Math.round(contentWidth * (kept.height / height)));
      width = kept.width;
      height = kept.height;
    }
  }
  const previous = existingSame ? descriptorOf(disk.files, existingSame.path) : null;
  if (kept) usages = kept.usages;
  const fn = kept ? kept.function : (imageFunctionOf({ function: fields.function }) ?? undefined);
  const ascentValue = kept
    ? kept.ascent
    : type === "glyph"
      ? ascentRaw !== null
        ? Number.parseInt(ascentRaw, 10)
        : 8
      : null;
  if (ascentValue !== null && !Number.isFinite(ascentValue)) fail(400, "Invalid ascent");
  const codepointValue = kept
    ? kept.codepoint
    : type === "glyph"
      ? nextFreeCodepoint(disk.assets)
      : null;
  await overlay.writeAsset({
    type,
    name,
    bytes: file,
    descriptor: {
      ascent: ascentValue,
      codepoint: codepointValue,
      width,
      height,
      content_width: contentWidth,
      usages,
      function: fn,
      slice: kept?.slice,
    },
    baseHash: existingSame?.hash ?? null,
    ...(previous ? { previous: { path: previous.path, hash: textHash(previous.content) } } : {}),
  });
  return {
    asset: JSON.parse(
      JSON.stringify({
        id: assetFileName(name),
        projectId,
        type,
        name,
        width,
        height,
        ascent: ascentValue,
        codepoint: codepointValue,
        fontMeta: null,
        usages,
        function: fn,
        slice: kept?.slice,
        contentHash: sha256Hex(file),
        createdAt: now,
        updatedAt: now,
      }),
    ),
  };
}

function lookup(disk: DiskAssetsTree, id: string): DiskAsset {
  return disk.assets.find((a) => a.row.id === id) ?? fail(404, "Not found");
}

/**
 * The recipe a request carries (`{layers, width, height}`, as `Asset.compose`), read as the pack
 * reads a descriptor: refused unless the pack reads back that very recipe, with a layer at least.
 */
function requestedRecipe(value: unknown): ComposeRecipe {
  const input = (value && typeof value === "object" ? value : {}) as Partial<ComposeRecipe>;
  const layers = Array.isArray(input.layers) ? input.layers : [];
  const invalid: () => never = () =>
    fail(400, "Invalid compose (layers: image, x, y, columns, rows, width, height)");
  if (
    layers.some((layer) => !layer || typeof layer !== "object" || typeof layer.image !== "string")
  )
    invalid();
  const [width, height] = [input.width ?? null, input.height ?? null];
  const recipe = composeRecipe({
    compose: composeYaml({ layers, width, height }),
    width: width ?? undefined,
    height: height ?? undefined,
  });
  const same = (a: ComposeRecipe["layers"][number], b: ComposeRecipe["layers"][number]) =>
    a.image === b.image &&
    a.x === b.x &&
    a.y === b.y &&
    a.columns === b.columns &&
    a.rows === b.rows &&
    a.width === b.width &&
    a.height === b.height;
  if (
    !recipe ||
    recipe.layers.length === 0 ||
    recipe.layers.length !== layers.length ||
    recipe.width !== width ||
    recipe.height !== height ||
    !recipe.layers.every((layer, i) => same(layer, layers[i] as ComposeRecipe["layers"][number]))
  )
    invalid();
  return recipe;
}

/** What a descriptor holds of `recipe`: its layers, and its size when it gives one. */
function recipeFields(recipe: ComposeRecipe): Record<string, unknown> {
  return {
    width: recipe.width ?? undefined,
    height: recipe.height ?? undefined,
    compose: composeYaml(recipe),
  };
}

/** The descriptor of a composed image (its `path`): its text's hash, and what it holds. */
function composedDescriptor(disk: DiskAssetsTree, asset: DiskAsset) {
  const content = disk.files.find((f) => f.path === asset.path)?.content ?? fail(404, "Not found");
  let parsed: Record<string, unknown> = {};
  try {
    const value = parse(content);
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
  } catch {
    // It was read as a recipe a moment ago: unreachable, and nothing is kept if it happens.
  }
  return { hash: textHash(content), parsed };
}

async function patch(
  overlay: DraftOverlay,
  id: string,
  body: Record<string, unknown>,
): Promise<Body> {
  const disk = overlay.read();
  const found = lookup(disk, id);
  const row = found.row;
  const nextUsages = body.usages === undefined ? row.usages : parseAssetUsages(body.usages);
  if (body.usages !== undefined && (row.type === "font" || nextUsages === undefined))
    fail(400, "Invalid usages (images only; button, menu)");
  if (typeof body.name === "string" && !NAME_RE.test(body.name)) fail(400, "Invalid name");
  // `function: ""` clears it; an unknown one is refused.
  if (body.function !== undefined && body.function !== "" && !imageFunctionOf(body))
    fail(400, "Invalid function (menu, glyph, hud)");
  if (body.function !== undefined && row.type === "font")
    fail(400, "function only valid for an image");
  const nextFunction =
    body.function === undefined ? row.function : (imageFunctionOf(body) ?? undefined);
  // `slice: null` takes the margins off; margins that are not whole numbers ≥ 0 are refused.
  if (body.slice !== undefined && body.slice !== null && !sliceOf({ slice: body.slice }))
    fail(400, "Invalid slice (left, right, top, bottom: whole numbers, one above 0)");
  if (body.slice && row.type === "font") fail(400, "slice only valid for an image");
  const nextSlice =
    body.slice === undefined ? row.slice : (sliceOf({ slice: body.slice }) ?? undefined);
  const nextName = typeof body.name === "string" ? body.name : row.name;
  if (typeof body.ascent === "number" && row.type !== "glyph")
    fail(400, "ascent only valid for glyph");
  const nextAscent = typeof body.ascent === "number" ? body.ascent : row.ascent;

  // A glyph's height drives its width (advance rendered by Minecraft).
  let nextHeight = row.height;
  let nextWidth = row.width;
  let nextContentWidth = row.contentWidth;
  if (typeof body.height === "number") {
    if (row.type !== "glyph") fail(400, "height only valid for glyph");
    if (!Number.isInteger(body.height) || body.height < 1 || body.height > 256)
      fail(400, "Invalid height (must be integer between 1 and 256)");
    if (row.height > 0 && row.width > 0)
      nextWidth = Math.max(1, Math.round(row.width * (body.height / row.height)));
    if (typeof row.contentWidth === "number" && row.height > 0) {
      const scaled = Math.round(row.contentWidth * (body.height / row.height));
      nextContentWidth = row.contentWidth > 0 ? Math.max(1, scaled) : 0;
    }
    nextHeight = body.height;
  }
  if (nextName !== row.name && disk.assets.some((a) => a.row.id === assetFileName(nextName)))
    fail(409, "Asset name already exists");

  const renamed = nextName !== row.name;
  if (found.compose) {
    // A composed image is its descriptor: what changes is written there, the recipe kept as it is.
    if (typeof body.height === "number") fail(400, "height only valid for a glyph with a PNG");
    const current = composedDescriptor(disk, found);
    const recipe = body.compose === undefined ? found.compose : requestedRecipe(body.compose);
    const next: Record<string, unknown> = {
      ...current.parsed,
      ...(body.compose === undefined ? {} : recipeFields(recipe)),
    };
    if (nextAscent === null) next.ascent = undefined;
    else next.ascent = nextAscent;
    next.usages = nextUsages;
    next.function = nextFunction;
    next.slice = nextSlice;
    const to = renamed
      ? found.path.replace(/[^/]+(\.ya?ml)$/, `${assetFileName(nextName)}$1`)
      : found.path;
    await overlay.commit({
      files: [{ path: to, content: stringify(next), base_hash: renamed ? null : current.hash }],
      binaries: [],
      deletes: renamed ? [{ path: found.path, base_hash: current.hash }] : [],
    });
    return {
      asset: {
        ...serialize({
          ...row,
          id: assetFileName(nextName),
          name: nextName,
          ascent: nextAscent,
          usages: nextUsages,
          function: nextFunction,
        }),
        ...(await overlay.view(
          disk,
          recipe === found.compose ? found : { ...found, compose: recipe },
        )),
      },
    };
  }
  if (body.compose !== undefined) fail(400, "compose only valid for a composed image");
  const bytes = await overlay.bytes(found);
  if (!bytes) fail(503, "server_offline");
  const previous = descriptorOf(disk.files, found.path);
  await overlay.writeAsset(
    {
      type: row.type,
      name: nextName,
      bytes,
      descriptor: {
        ascent: nextAscent,
        codepoint: row.codepoint,
        width: nextWidth,
        height: nextHeight,
        content_width: nextContentWidth,
        usages: nextUsages,
        function: nextFunction,
        slice: nextSlice,
      },
      baseHash: renamed ? null : found.hash,
      ...(previous && !renamed
        ? { previous: { path: previous.path, hash: textHash(previous.content) } }
        : {}),
    },
    renamed
      ? {
          path: found.path,
          hash: found.hash,
          descriptor: previous ? { path: previous.path, hash: textHash(previous.content) } : null,
        }
      : undefined,
  );
  return {
    asset: serialize({
      ...row,
      id: assetFileName(nextName),
      name: nextName,
      ascent: nextAscent,
      height: nextHeight,
      width: nextWidth,
      contentWidth: nextContentWidth,
      usages: nextUsages,
      function: nextFunction,
      slice: nextSlice,
    }),
  };
}

async function duplicate(overlay: DraftOverlay, id: string): Promise<Body> {
  const disk = overlay.read();
  const found = lookup(disk, id);
  const src = found.row;
  if (src.type !== "glyph") fail(400, "Only glyph assets can be duplicated");
  const taken = new Set(disk.assets.map((a) => a.row.id));
  let newName = `${src.name}_copy`;
  for (let n = 2; taken.has(assetFileName(newName)); n++) newName = `${src.name}_copy${n}`;
  // A copy never shares its original's codepoint.
  const codepoint = nextFreeCodepoint(disk.assets);
  if (found.compose) {
    const current = composedDescriptor(disk, found);
    const to = found.path.replace(/[^/]+(\.ya?ml)$/, `${assetFileName(newName)}$1`);
    await overlay.commit({
      files: [{ path: to, content: stringify({ ...current.parsed, codepoint }), base_hash: null }],
      binaries: [],
    });
    return {
      asset: {
        ...serialize({ ...src, id: assetFileName(newName), name: newName, codepoint }),
        ...(await overlay.view(disk, found)),
      },
    };
  }
  const bytes = await overlay.bytes(found);
  if (!bytes) fail(503, "server_offline");
  await overlay.writeAsset({
    type: src.type,
    name: newName,
    bytes,
    descriptor: {
      ascent: src.ascent,
      codepoint,
      width: src.width,
      height: src.height,
      content_width: src.contentWidth,
      usages: src.usages,
      function: src.function,
      slice: src.slice,
    },
    baseHash: null,
  });
  return { asset: serialize({ ...src, id: assetFileName(newName), name: newName, codepoint }) };
}

async function remove(overlay: DraftOverlay, id: string): Promise<Body> {
  const disk = overlay.read();
  const found = lookup(disk, id);
  if (found.row.type === "font") {
    // A font is a folder: its glyphs go with it.
    const dir = found.path.slice(0, found.path.lastIndexOf("/"));
    const meta = found.row.fontMeta as { glyphMap?: { texture: string }[] } | null;
    const glyphs: WriteBatch["binaries"] = [];
    for (const g of meta?.glyphMap ?? []) {
      const path = `${dir}/${g.texture}`;
      const bin = disk.binaries.find((b) => b.path === path);
      if (bin) glyphs.push({ path, content: null, baseHash: bin.hash });
    }
    await overlay.commit({
      files: [],
      binaries: glyphs,
      deletes: [
        {
          path: found.path,
          base_hash: textHash(disk.files.find((f) => f.path === found.path)?.content ?? ""),
        },
      ],
    });
    return {};
  }
  if (found.compose) {
    // Its descriptor is the whole of it.
    await overlay.commit({
      files: [],
      binaries: [],
      deletes: [{ path: found.path, base_hash: composedDescriptor(disk, found).hash }],
    });
    return {};
  }
  const path = assetDiskPath(found.row.type, found.row.name);
  const previous = descriptorOf(disk.files, found.path);
  await overlay.commit({
    files: [],
    binaries: [{ path, content: null, baseHash: found.hash }],
    deletes: previous ? [{ path: previous.path, base_hash: textHash(previous.content) }] : [],
  });
  return {};
}

/**
 * An asset of another Project, copied in (fields from `copyAsset`): same files,
 * a free name, and for a glyph a codepoint of this Project. The copy keeps no
 * link to its source: changing the original later changes nothing here.
 */
async function copyIn(overlay: DraftOverlay, projectId: string, fields: Record<string, string>) {
  const type = fields.type ?? "";
  const sourceName = fields.name ?? "";
  if (!["texture", "glyph", "font"].includes(type)) fail(400, "Invalid type");
  if (!NAME_RE.test(sourceName)) fail(400, "Invalid name");
  const files = JSON.parse(fields.files ?? "[]") as { path: string; base64: string }[];
  if (type !== "font" && files.length !== 1) fail(400, "Missing file");
  // A glyph path stays inside the font folder.
  if (
    type === "font" &&
    files.some(
      (f) => f.path.startsWith("/") || f.path.split("/").some((seg) => seg === ".." || !seg),
    )
  )
    fail(400, "Invalid path");
  const disk = overlay.read();
  const name = freeAssetName(
    sourceName,
    disk.assets.map((a) => a.row.id),
  );
  const parsed = (() => {
    try {
      const value = fields.descriptor ? parse(fields.descriptor) : {};
      return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  const now = new Date().toISOString();
  if (type === "font") {
    const dir = fontDir(name);
    const descriptor = stringify({ ...parsed, namespace: `artisan:${assetFileName(name)}` });
    await overlay.commit({
      files: [{ path: `${dir}/${FONT_DESCRIPTOR}`, content: descriptor, base_hash: null }],
      binaries: files.map((f) => ({
        path: `${dir}/${f.path}`,
        content: fromBase64(f.base64),
        baseHash: null,
      })),
    });
    return {
      asset: {
        id: assetFileName(name),
        projectId,
        type: "font" as const,
        name,
        width: 0,
        height: 0,
        ascent: null,
        codepoint: null,
        fontMeta: fontFromDisk(descriptor),
        contentHash: textHash(descriptor),
        createdAt: now,
        updatedAt: now,
      },
    };
  }
  const bytes = fromBase64(files[0]!.base64);
  const path = assetDiskPath(type, name);
  const codepoint = type === "glyph" ? nextFreeCodepoint(disk.assets) : null;
  const descriptor = type === "glyph" ? { ...parsed, codepoint } : parsed;
  await overlay.commit({
    files: Object.keys(descriptor).length
      ? [{ path: descriptorPath(path), content: stringify(descriptor), base_hash: null }]
      : [],
    binaries: [{ path, content: bytes, baseHash: null }],
  });
  const row = diskAssetsFromTree(
    projectId,
    [{ path: descriptorPath(path), content: stringify(descriptor) }],
    [{ path, hash: sha256Hex(bytes), size: bytes.length }],
  )[0]!.row;
  return { asset: serialize(row) };
}

/**
 * Applies an asset mutation to the private draft. Failures are
 * `DraftApiError`s carrying the matching code and status.
 */
/** A Version's images and fonts back into the draft: changed ones read from the Version, the others removed. */
async function restoreBinaries(
  overlay: DraftOverlay,
  projectId: string,
  fields: Record<string, string>,
) {
  const versionId = fields.versionId;
  if (!versionId) fail(422, "invalid_input");
  const wanted = JSON.parse(fields.binaries ?? "[]") as { path: string; hash: string }[];
  const current = overlay.read().binaries;
  const binaries: WriteBatch["binaries"] = [];
  for (const binary of wanted) {
    const have = current.find((c) => c.path === binary.path);
    if (have?.hash === binary.hash) continue;
    const content = await readVersionBinary(projectId, versionId, binary.path).catch(() =>
      fail(503, "storage_unavailable"),
    );
    if (sha256Hex(content) !== binary.hash) fail(503, "storage_unavailable");
    binaries.push({ path: binary.path, content, baseHash: have?.hash ?? null });
  }
  for (const c of current)
    if (!wanted.some((w) => w.path === c.path))
      binaries.push({ path: c.path, content: null, baseHash: c.hash });
  await overlay.commit({ files: [], binaries });
}

export async function performLocalAssetMutation(
  projectId: string,
  operation: AssetMutation,
): Promise<LocalAssetResult> {
  const input = operation.asset!;
  if (!operation.snapshot || !Number.isInteger(operation.revision) || operation.revision < 1)
    fail(422, "invalid_draft");
  const overlay = new DraftOverlay(projectId, operation);
  if (input.suffix === "/restore" && input.method === "POST") {
    await restoreBinaries(overlay, projectId, input.fields);
    if (!overlay.updatedDraft) throw new Error("draft_acknowledgement_missing");
    return { draft: { ...overlay.updatedDraft, projectId } };
  }
  if (input.suffix === "/copy" && input.method === "POST") {
    const body = await copyIn(overlay, projectId, input.fields);
    if (!overlay.updatedDraft) throw new Error("draft_acknowledgement_missing");
    return { ...body, draft: { ...overlay.updatedDraft, projectId } };
  }
  const [, rawId, action] = input.suffix.split("/");
  const id = rawId === undefined ? undefined : decodeURIComponent(rawId);
  let body: Body;
  if (id === undefined && input.method === "POST")
    body = await create(
      overlay,
      projectId,
      input.fields,
      input.file ? fromBase64(input.file.base64) : null,
    );
  else if (id !== undefined && action === "duplicate" && input.method === "POST")
    body = await duplicate(overlay, id);
  else if (id !== undefined && action === undefined && input.method === "PATCH")
    body = await patch(overlay, id, assetJsonFields(input.fields));
  else if (id !== undefined && action === undefined && input.method === "DELETE")
    body = await remove(overlay, id);
  else fail(404, "not_found");
  if (!overlay.updatedDraft) throw new Error("draft_acknowledgement_missing");
  return { ...body, draft: { ...overlay.updatedDraft, projectId } };
}
