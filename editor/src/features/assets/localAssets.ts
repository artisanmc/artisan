import type { Asset, AssetType } from "@/domain/asset";
import type { ProjectDraft } from "@/features/project/draft";
import type { AssetMutation } from "@/features/project/persistedDrafts";
import {
  DraftApiError,
  type PersistedDraft,
  readDraft,
  readDraftBlob,
  updateDraft,
  uploadDraftBlob,
} from "@/lib/api/projectDrafts";
import { readProjectFiles } from "@/lib/api/projectFiles";
import {
  type DiskAssetDescriptor,
  type DiskAssetsTree,
  assetDiskPath,
  assetFileName,
  descriptorOf,
  descriptorYaml,
  nextFreeCodepoint,
} from "@/lib/pack/assetDiskWrite";
import { type AssetUsage, parseAssetUsages } from "@/lib/pack/assetUsages";
import { type DiskAsset, diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { fontFilesFor, fontFromDisk } from "@/lib/pack/fontOnDisk";
import { type ParsedMcFont, parseMcFontsZip } from "@/lib/pack/mcFontsParser";
import { readPngContentWidth, readPngDimensions } from "@/lib/pack/pngDimensions";
import type { AssetRow } from "@/lib/pack/resourcePackBuilder";
import { projectFetch } from "@/lib/projectFetch";
import { sha256Hex } from "@/lib/sha256";

/**
 * Les assets d'un Project : l'éditeur les valide et les range lui-même, sur le
 * brouillon privé (snapshot + blobs) que le plugin garde déjà.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "";
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

/** Les champs d'une requête JSON d'asset, typés comme le client les envoie au backend. */
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

function toBase64(bytes: Uint8Array): string {
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

/** Liste : le snapshot du brouillon serveur s'il y en a un, sinon le disque publié. */
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

/** `DraftAssetStorage` côté navigateur : lit le snapshot figé, écrit blobs puis révision. */
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

  /** Octets vérifiés d'un asset : publiés s'ils n'ont pas bougé, sinon blob du brouillon. */
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

  private async published(path: string): Promise<Uint8Array | null> {
    const response = await projectFetch(
      this.projectId,
      `${API_URL}/api/v1/projects/${encodeURIComponent(this.projectId)}/binary?path=${encodeURIComponent(path)}`,
      { credentials: "include" },
    ).catch(() => fail(503, "storage_unavailable"));
    if (response.status === 404 || response.status === 422) return null;
    if (!response.ok) fail(503, "storage_unavailable");
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Tout ou rien : base hashes contrôlés, blobs posés, puis une seule révision. */
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
      descriptorBaseHash: string | null;
    },
    remove?: { path: string; hash: string; descriptorHash: string | null },
  ) {
    const path = assetDiskPath(input.type, input.name);
    return this.commit({
      files: [
        {
          path: path.replace(/\.png$/, ".yaml"),
          content: descriptorYaml(input.descriptor),
          base_hash: input.descriptorBaseHash,
        },
      ],
      binaries: [
        { path, content: input.bytes, baseHash: input.baseHash },
        ...(remove ? [{ path: remove.path, content: null, baseHash: remove.hash }] : []),
      ],
      deletes: remove?.descriptorHash
        ? [{ path: remove.path.replace(/\.png$/, ".yaml"), base_hash: remove.descriptorHash }]
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

  // Police dépliée : un PNG par glyphe plus son descripteur, en une révision.
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
  // `replace` = réimport : nouveaux pixels, même codepoint/ascent/usages.
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
    descriptorBaseHash: previous ? textHash(previous.content) : null,
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

  // La hauteur d'un glyphe entraîne sa largeur (avance rendue par Minecraft).
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
      descriptorBaseHash: renamed ? null : previous ? textHash(previous.content) : null,
    },
    renamed
      ? {
          path: found.path,
          hash: found.hash,
          descriptorHash: previous ? textHash(previous.content) : null,
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
  // Une copie ne partage jamais le codepoint de son original.
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
    descriptorBaseHash: null,
  });
  return { asset: serialize({ ...src, id: assetFileName(newName), name: newName, codepoint }) };
}

async function remove(overlay: DraftOverlay, id: string): Promise<Body> {
  const disk = overlay.read();
  const found = lookup(disk, id);
  if (found.row.type === "font") {
    // Une police est un dossier : ses glyphes partent avec elle.
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
    deletes: previous
      ? [{ path: path.replace(/\.png$/, ".yaml"), base_hash: textHash(previous.content) }]
      : [],
  });
  return {};
}

/**
 * Applique une mutation d'asset au brouillon privé, comme le ferait
 * `POST|PATCH|DELETE /api/v1/user/projects/:id/assets…?draftId=` sur le backend.
 * Les échecs sont des `DraftApiError` portant le même code et le même statut.
 */
export async function performLocalAssetMutation(
  projectId: string,
  operation: AssetMutation,
): Promise<LocalAssetResult> {
  const input = operation.asset!;
  if (!operation.snapshot || !Number.isInteger(operation.revision) || operation.revision < 1)
    fail(422, "invalid_draft");
  const overlay = new DraftOverlay(projectId, operation);
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
