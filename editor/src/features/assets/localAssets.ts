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
import { type DiskAsset, diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { FONT_DESCRIPTOR, fontDir, fontFilesFor, fontFromDisk } from "@/lib/pack/fontOnDisk";
import { type ParsedMcFont, parseMcFontsZip } from "@/lib/pack/mcFontsParser";
import { readPngContentWidth, readPngDimensions } from "@/lib/pack/pngDimensions";
import type { AssetRow } from "@/lib/pack/resourcePackBuilder";
import { sha256Hex } from "@/lib/sha256";
import { parse, stringify } from "yaml";

/**
 * A Project's assets: the editor validates and stores them itself, on the
 * private draft (snapshot + blobs) the plugin already keeps.
 */

const NAME_RE = /^[a-z0-9_-]+$/;
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
      key === "usages"
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
      contentHash: row.contentHash,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  ) as Asset;
}

/** List: the server draft's snapshot if there is one, otherwise the published disk. */
export async function listLocalAssets(
  projectId: string,
  filters: { type?: AssetType; search?: string },
  draftId?: string,
): Promise<Asset[]> {
  let files: Tree;
  let binaries: Binaries;
  if (draftId) {
    const { snapshot } = await readDraft(projectId, draftId);
    files = Object.entries(snapshot.tree).map(([path, content]) => ({ path, content }));
    binaries = Object.entries(snapshot.binaryTree ?? {}).map(([path, meta]) => ({ path, ...meta }));
  } else {
    const read = await readProjectFiles(projectId);
    if (!read.ok || read.unchanged) throw new Error("Failed to load assets");
    files = Object.entries(read.files).map(([path, content]) => ({ path, content }));
    binaries = read.binaries ?? [];
  }
  return diskAssetsFromTree(projectId, files, binaries)
    .map((a) => a.row)
    .filter((r) => !filters.type || r.type === filters.type)
    .filter((r) => !filters.search || r.name.toLowerCase().includes(filters.search.toLowerCase()))
    .map(serialize);
}

/** A published binary of a Project, `null` when the disk does not have it. */
async function readPublishedBinary(projectId: string, path: string): Promise<Uint8Array | null> {
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
    diskAssetsFromTree(projectId, files, binaries).find(
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
  if (!NAME_RE.test(name)) fail(400, "Invalid name (must match [a-z0-9_-]+)");
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
  const existingSame = disk.assets.find((a) => a.path === path);
  // `replace` = reimport: new pixels, same codepoint/ascent/usages.
  const replace = fields.replace === "true";
  if (existingSame && !replace) fail(409, "Asset name already exists");
  if (!existingSame && replace) fail(404, "not_found");
  const kept = existingSame?.row;
  const previous = existingSame ? descriptorOf(disk.files, existingSame.path) : null;
  if (kept) usages = kept.usages;
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

  const bytes = await overlay.bytes(found);
  if (!bytes) fail(503, "server_offline");
  const previous = descriptorOf(disk.files, found.path);
  const renamed = nextName !== row.name;
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
  const bytes = await overlay.bytes(found);
  if (!bytes) fail(503, "server_offline");
  // A copy never shares its original's codepoint.
  const codepoint = nextFreeCodepoint(disk.assets);
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
