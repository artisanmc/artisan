// backend/src/lib/assetHandlers.ts
// Business logic for asset CRUD, shared by the user-scoped router
// (routes/userAssets.ts — cookie + membership guard). Extracted from the
// former session-token router (routes/assets.ts, deleted in the
// accounts-only cutover, Task 7) so there is exactly ONE implementation.
import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index";
import { assets, projects } from "../db/schema";
import { parseMcFontsZip, type ParsedMcFont } from "./mcFontsParser";
import { readPngDimensions, readPngContentWidth } from "./pngDimensions";
import { rebuildResourcePack } from "./resourcePack";
import { projectDiskId } from "./projectStorage";
import {
  assetDiskPath,
  assetFileName,
  deleteDiskAsset,
  deleteDiskFont,
  descriptorOf,
  type DiskAssetsTree,
  nextFreeCodepoint,
  readDiskAssets,
  writeDiskAsset,
} from "./assetDiskWrite";
import { fontFilesFor, fontFromDisk } from "./fontOnDisk";
import { requestAssetWrite, requestProjectWrite } from "../ws/hub";
import { type DiskAsset, readDiskAssetBytes } from "./diskAssets";
import { pushResourcePackUpdated } from "../ws/hub";

const NAME_RE = /^[a-z0-9_-]+$/;

/** Empreinte d'un contenu texte — le jeton de compare-and-swap du plugin. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
const MAX_RAW_BYTES = 2 * 1024 * 1024;       // 2 MB (texture/glyph PNG)
const MAX_FONT_BYTES = 5 * 1024 * 1024;      // 5 MB (font zip)

type AssetCtx = { projectId: string; serverKeyId: string };

export async function handleAssetCreate(c: any, ctx: AssetCtx) {
  const { projectId, serverKeyId } = ctx;
  const form = await c.req.parseBody();
  const type = String(form.type ?? "");
  const name = String(form.name ?? "");
  const ascentRaw = form.ascent !== undefined ? String(form.ascent) : null;
  const file = form.file;

  if (!["texture", "glyph", "font"].includes(type)) {
    return c.json({ error: "Invalid type (must be texture, glyph, or font)" }, 400);
  }
  if (!NAME_RE.test(name)) {
    return c.json({ error: "Invalid name (must match [a-z0-9_-]+)" }, 400);
  }
  if (!(file instanceof File)) {
    return c.json({ error: "Missing file" }, 400);
  }
  const maxBytes = type === "font" ? MAX_FONT_BYTES : MAX_RAW_BYTES;
  if (file.size > maxBytes) {
    const mb = type === "font" ? 5 : 2;
    return c.json({ error: `File too large (max ${mb} MB)` }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // For texture/glyph, read PNG dims. For fonts, dimensions stay 0/0 (per-glyph dims
  // live inside fontMeta.glyphMap[]).
  let width = 0;
  let height = 0;
  let contentWidth: number | null = null;
  let parsedFont: ParsedMcFont | null = null;

  if (type === "font") {
    try {
      parsedFont = parseMcFontsZip(bytes);
    } catch (err) {
      return c.json({ error: `Invalid font zip: ${(err as Error).message}` }, 400);
    }
    if (parsedFont.glyphMap.length === 0) {
      return c.json({ error: "Empty font (no usable glyphs)" }, 400);
    }
  } else {
    try {
      const dims = readPngDimensions(bytes);
      width = dims.width;
      height = dims.height;
    } catch {
      return c.json({ error: "Invalid PNG" }, 400);
    }
    contentWidth = readPngContentWidth(bytes);
  }

  const contentHash = createHash("sha1").update(bytes).digest("hex");
  // Empreinte telle que le DISQUE la rapportera (SHA-256 des octets) : sans
  // ça, la même image aurait deux empreintes selon qu'on vient de la créer ou
  // de la lister, et l'URL d'aperçu changerait sans que rien n'ait bougé.
  const diskContentHash = createHash("sha256").update(bytes).digest("hex");

  // ── Disque du serveur (ADR `assets-on-server-disk`, P5) ────────────────────
  // Tout devient fichier du Project : le backend relaie, le plugin écrit.
  // Une POLICE est DÉPLIÉE — un PNG par glyphe plus son descripteur — parce
  // qu'une boîte noire au milieu d'un dossier éditable à la main coûterait plus
  // cher que ses ~96 entrées (mesuré sur l'ASCII vanilla : 26 Ko).
  if (type === "font" && parsedFont) {
    const anchor = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!anchor) return c.json({ error: "Not found" }, 404);
    const diskId = projectDiskId(anchor);
    const disk = await readDiskAssets(serverKeyId, diskId, projectId);
    if (!disk.ok) return c.json({ error: disk.error }, disk.error === "server_offline" ? 503 : 502);
    if (disk.assets.some((a) => a.row.type === "font" && a.row.id === assetFileName(name))) {
      return c.json({ error: "Asset name already exists" }, 409);
    }

    const { binaries, descriptor } = fontFilesFor(name, parsedFont);
    // Les glyphes en UN seul envoi, tout ou rien : une police à moitié posée
    // afficherait des carrés à la place des lettres manquantes.
    const written = await requestAssetWrite(serverKeyId, {
      projectId: diskId,
      files: binaries.map((b) => ({
        path: b.path,
        contentBase64: Buffer.from(b.bytes).toString("base64"),
        baseHash: null,
      })),
    });
    if (written.kind === "offline") return c.json({ error: "server_offline" }, 503);
    if (written.kind !== "result" || !written.result.ok) {
      const err = written.kind === "result" ? written.result.error : "write_error";
      return c.json({ error: err ?? "write_error" }, err === "conflict" ? 409 : 502);
    }
    const desc = await requestProjectWrite(serverKeyId, {
      projectId: diskId,
      files: [{ path: descriptor.path, content: descriptor.content, base_hash: null }],
    });
    if (desc.kind !== "result" || !desc.result.ok) {
      return c.json({ error: "write_error" }, 502);
    }

    const packInfo = await rebuildResourcePack(serverKeyId);
    pushResourcePackUpdated(serverKeyId, packInfo.url, packInfo.hash);
    const now = new Date();
    const body: Record<string, unknown> = {
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
        contentHash: createHash("sha256").update(descriptor.content, "utf8").digest("hex"),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    };
    if (parsedFont.warnings.length > 0) body.warnings = parsedFont.warnings;
    return c.json(body, 201);
  }

  if (type !== "font") {
    const anchor = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!anchor) return c.json({ error: "Not found" }, 404);
    const diskId = projectDiskId(anchor);
    const disk = await readDiskAssets(serverKeyId, diskId, projectId);
    // Serveur injoignable = pas d'écriture, comme pour les menus. On ne range
    // pas l'image « en attendant » : elle serait invisible du serveur et
    // l'admin la croirait posée.
    if (!disk.ok) return c.json({ error: disk.error }, disk.error === "server_offline" ? 503 : 502);

    const path = assetDiskPath(type, name);
    const existingSame = disk.assets.find((a) => a.path === path);
    if (existingSame) return c.json({ error: "Asset name already exists" }, 409);

    const ascentValue = type === "glyph"
      ? (ascentRaw !== null ? parseInt(ascentRaw, 10) : 8)
      : null;
    if (ascentValue !== null && !Number.isFinite(ascentValue)) {
      return c.json({ error: "Invalid ascent" }, 400);
    }
    const codepointValue = type === "glyph" ? nextFreeCodepoint(disk.assets) : null;

    const written = await writeDiskAsset(serverKeyId, diskId, {
      type,
      name,
      bytes,
      descriptor: {
        ascent: ascentValue,
        codepoint: codepointValue,
        width,
        height,
        content_width: contentWidth,
      },
      baseHash: null,
      descriptorBaseHash: null,
    });
    if (!written.ok) {
      const status = written.error === "server_offline" ? 503 : written.error === "conflict" ? 409 : 502;
      return c.json({ error: written.error ?? "write_error" }, status);
    }

    const packInfo = await rebuildResourcePack(serverKeyId);
    pushResourcePackUpdated(serverKeyId, packInfo.url, packInfo.hash);
    const now = new Date();
    return c.json({
      asset: {
        id: assetFileName(name),
        projectId,
        type,
        name,
        width,
        height,
        ascent: ascentValue,
        codepoint: codepointValue,
        fontMeta: null,
        contentHash: diskContentHash,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    }, 201);
  }
}

export async function handleAssetList(c: any, ctx: { projectId: string; serverKeyId?: string }) {
  const { projectId } = ctx;
  const typeParam = c.req.query("type");
  const searchParam = c.req.query("search");

  // Le disque du serveur décide seul de ce qui existe (ADR
  // `assets-on-server-disk`). Plus de repli sur la table : il faisait passer un
  // serveur muet pour une bibliothèque vide, et une ligne périmée pour un asset.
  const anchor = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!anchor || !ctx.serverKeyId) return c.json({ error: "Not found" }, 404);
  const disk = await readDiskAssets(ctx.serverKeyId, projectDiskId(anchor), projectId);
  if (!disk.ok) return c.json({ error: disk.error }, disk.error === "server_offline" ? 503 : 502);

  const rows = disk.assets
    .map((a) => a.row)
    .filter((r) => !typeParam || r.type === typeParam)
    .filter(
      (r) => !searchParam || r.name.toLowerCase().includes(String(searchParam).toLowerCase()),
    );
  return c.json({ assets: rows.map(serialize) });
}

/**
 * L'asset sur le disque du serveur — ou la raison pour laquelle on ne l'a pas.
 *
 * La distinction n'est plus décorative depuis que la table ne rattrape plus
 * rien : « le serveur n'a pas répondu » autorise à réessayer plus tard, « il
 * n'y est pas » autorise à conclure. Les confondre ferait disparaître une
 * bibliothèque entière le temps d'un redémarrage.
 */
type DiskLookup =
  | { ok: true; diskId: string; disk: DiskAssetsTree; found: DiskAsset }
  | { ok: false; error: "server_offline" | "read_error" | "not_found" };

async function diskLookup(
  projectId: string,
  serverKeyId: string | undefined,
  id: string,
): Promise<DiskLookup> {
  if (!serverKeyId) return { ok: false, error: "not_found" };
  const anchor = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!anchor) return { ok: false, error: "not_found" };
  const diskId = projectDiskId(anchor);
  const disk = await readDiskAssets(serverKeyId, diskId, projectId);
  if (!disk.ok) return { ok: false, error: disk.error };
  const found = disk.assets.find((a) => a.row.id === id);
  if (!found) return { ok: false, error: "not_found" };
  return { ok: true, diskId, disk, found };
}

/** Le statut HTTP de chaque échec de lecture disque, dit une seule fois. */
function diskLookupError(c: any, error: "server_offline" | "read_error" | "not_found") {
  if (error === "not_found") return c.json({ error: "Not found" }, 404);
  return c.json({ error }, error === "server_offline" ? 503 : 502);
}

export async function handleAssetGet(c: any, ctx: { projectId: string; serverKeyId?: string }) {
  const onDisk = await diskLookup(ctx.projectId, ctx.serverKeyId, c.req.param("id"));
  if (!onDisk.ok) return diskLookupError(c, onDisk.error);
  return c.json({ asset: serialize(onDisk.found.row) });
}

export async function handleAssetPatch(c: any, ctx: AssetCtx) {
  const { projectId, serverKeyId } = ctx;
  const id = c.req.param("id");

  // Sur le disque, éditer un asset c'est réécrire son DESCRIPTEUR (ascent…) ou
  // RENOMMER son fichier — le nom EST l'identité (ADR décision 2).
  const onDisk = await diskLookup(projectId, serverKeyId, id);
  if (!onDisk.ok) return diskLookupError(c, onDisk.error);
  {
    const body = await c.req.json().catch(() => ({}));
    const row = onDisk.found.row;
    if (typeof body.name === "string" && !NAME_RE.test(body.name)) {
      return c.json({ error: "Invalid name" }, 400);
    }
    const nextName = typeof body.name === "string" ? body.name : row.name;
    if (typeof body.ascent === "number" && row.type !== "glyph") {
      return c.json({ error: "ascent only valid for glyph" }, 400);
    }
    const nextAscent = typeof body.ascent === "number" ? body.ascent : row.ascent;

    // La hauteur d'un glyphe entraîne sa largeur : l'avance rendue par
    // Minecraft vaut `largeur × (hauteur / hauteur du PNG)`. Changer l'une sans
    // l'autre décalerait tout ce qui suit le glyphe dans un titre.
    let nextHeight = row.height;
    let nextWidth = row.width;
    let nextContentWidth = row.contentWidth;
    if (typeof body.height === "number") {
      if (row.type !== "glyph") return c.json({ error: "height only valid for glyph" }, 400);
      if (!Number.isInteger(body.height) || body.height < 1 || body.height > 256) {
        return c.json({ error: "Invalid height (must be integer between 1 and 256)" }, 400);
      }
      if (row.height > 0 && row.width > 0) {
        nextWidth = Math.max(1, Math.round(row.width * (body.height / row.height)));
      }
      if (typeof row.contentWidth === "number" && row.height > 0) {
        const scaled = Math.round(row.contentWidth * (body.height / row.height));
        nextContentWidth = row.contentWidth > 0 ? Math.max(1, scaled) : 0;
      }
      nextHeight = body.height;
    }
    if (nextName !== row.name && onDisk.disk.assets.some((a) => a.row.id === assetFileName(nextName))) {
      return c.json({ error: "Asset name already exists" }, 409);
    }

    const bytes = await readDiskAssetBytes(serverKeyId, onDisk.diskId, onDisk.found);
    if (!bytes) return c.json({ error: "server_offline" }, 503);
    const descriptor = {
      ascent: nextAscent,
      codepoint: row.codepoint,
      width: nextWidth,
      height: nextHeight,
      content_width: nextContentWidth,
    };
    const previous = descriptorOf(onDisk.disk.files, onDisk.found.path);
    if (nextName !== row.name) {
      // Renommer = écrire sous le nouveau nom puis retirer l'ancien. Pas de
      // `renames` ici : le protocole binaire écrit un fichier à la fois, et
      // l'ordre choisi ne peut pas perdre l'image.
      const written = await writeDiskAsset(serverKeyId, onDisk.diskId, {
        type: row.type, name: nextName, bytes, descriptor,
        baseHash: null, descriptorBaseHash: null,
      });
      if (!written.ok) {
        return c.json({ error: written.error ?? "write_error" }, written.error === "conflict" ? 409 : 502);
      }
      await deleteDiskAsset(serverKeyId, onDisk.diskId, {
        type: row.type, name: row.name, baseHash: onDisk.found.hash,
        descriptorBaseHash: previous ? sha256Hex(previous.content) : null,
      });
    } else {
      const written = await writeDiskAsset(serverKeyId, onDisk.diskId, {
        type: row.type, name: nextName, bytes, descriptor,
        baseHash: onDisk.found.hash,
        descriptorBaseHash: previous ? sha256Hex(previous.content) : null,
      });
      if (!written.ok) {
        return c.json({ error: written.error ?? "write_error" }, written.error === "conflict" ? 409 : 502);
      }
    }
    const packInfo = await rebuildResourcePack(serverKeyId);
    pushResourcePackUpdated(serverKeyId, packInfo.url, packInfo.hash);
    return c.json({
      asset: serialize({
        ...row,
        id: assetFileName(nextName),
        name: nextName,
        ascent: nextAscent,
        height: nextHeight,
        width: nextWidth,
        contentWidth: nextContentWidth,
      }),
    });
  }

}

export async function handleAssetDuplicate(c: any, ctx: AssetCtx) {
  const { projectId, serverKeyId } = ctx;
  const id = c.req.param("id");

  const onDisk = await diskLookup(projectId, serverKeyId, id);
  if (!onDisk.ok) return diskLookupError(c, onDisk.error);
  {
    const src = onDisk.found.row;
    if (src.type !== "glyph") return c.json({ error: "Only glyph assets can be duplicated" }, 400);
    // « <nom>_copy », puis _copy2, _copy3… — c'est le disque qui dit ce qui est pris.
    const taken = new Set(onDisk.disk.assets.map((a) => a.row.id));
    let newName = `${src.name}_copy`;
    for (let n = 2; taken.has(assetFileName(newName)); n++) newName = `${src.name}_copy${n}`;

    const bytes = await readDiskAssetBytes(serverKeyId, onDisk.diskId, onDisk.found);
    if (!bytes) return c.json({ error: "server_offline" }, 503);
    const written = await writeDiskAsset(serverKeyId, onDisk.diskId, {
      type: src.type,
      name: newName,
      bytes,
      descriptor: {
        ascent: src.ascent,
        // Une copie ne peut pas partager le codepoint de son original : deux
        // glyphes sur le même point de code, c'est un seul glyphe affiché.
        codepoint: nextFreeCodepoint(onDisk.disk.assets),
        width: src.width,
        height: src.height,
        content_width: src.contentWidth,
      },
      baseHash: null,
      descriptorBaseHash: null,
    });
    if (!written.ok) {
      return c.json({ error: written.error ?? "write_error" }, written.error === "conflict" ? 409 : 502);
    }
    const packInfo = await rebuildResourcePack(serverKeyId);
    pushResourcePackUpdated(serverKeyId, packInfo.url, packInfo.hash);
    return c.json({
      asset: serialize({
        ...src,
        id: assetFileName(newName),
        name: newName,
        codepoint: nextFreeCodepoint(onDisk.disk.assets),
      }),
    });
  }

}

export async function handleAssetDelete(c: any, ctx: AssetCtx) {
  const { projectId, serverKeyId } = ctx;
  const id = c.req.param("id");

  const onDisk = await diskLookup(projectId, serverKeyId, id);
  if (!onDisk.ok) return diskLookupError(c, onDisk.error);
  if (onDisk.found.row.type === "font") {
    // Une police est un DOSSIER : ses glyphes partent avec elle, sinon ils
    // resteraient orphelins, invisibles et impossibles à retrouver.
    const dir = onDisk.found.path.slice(0, onDisk.found.path.lastIndexOf("/"));
    const meta = onDisk.found.row.fontMeta as { glyphMap?: { texture: string }[] } | null;
    const glyphs: Record<string, string> = {};
    for (const g of meta?.glyphMap ?? []) {
      const path = `${dir}/${g.texture}`;
      // L'empreinte vient des binaires BRUTS : les PNG d'une police ne sont pas
      // des assets à part entière, ils n'apparaissent pas dans `assets`.
      const bin = onDisk.disk.binaries.find((b) => b.path === path);
      if (bin) glyphs[path] = bin.hash;
    }
    const removed = await deleteDiskFont(serverKeyId, onDisk.diskId, {
      dir,
      glyphs,
      descriptorPath: onDisk.found.path,
      descriptorBaseHash: sha256Hex(
        onDisk.disk.files.find((f) => f.path === onDisk.found.path)?.content ?? "",
      ),
    });
    if (!removed.ok) {
      return c.json({ error: removed.error ?? "write_error" }, removed.error === "conflict" ? 409 : 502);
    }
    const packInfo = await rebuildResourcePack(serverKeyId);
    pushResourcePackUpdated(serverKeyId, packInfo.url, packInfo.hash);
    return c.body(null, 204);
  }
  {
    const previous = descriptorOf(onDisk.disk.files, onDisk.found.path);
    const removed = await deleteDiskAsset(serverKeyId, onDisk.diskId, {
      type: onDisk.found.row.type,
      name: onDisk.found.row.name,
      baseHash: onDisk.found.hash,
      descriptorBaseHash: previous ? sha256Hex(previous.content) : null,
    });
    if (!removed.ok) {
      return c.json({ error: removed.error ?? "write_error" }, removed.error === "conflict" ? 409 : 502);
    }
    const packInfo = await rebuildResourcePack(serverKeyId);
    pushResourcePackUpdated(serverKeyId, packInfo.url, packInfo.hash);
    return c.body(null, 204);
  }

}

function serialize(row: typeof assets.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as "texture" | "glyph" | "font",
    name: row.name,
    width: row.width,
    height: row.height,
    ascent: row.ascent,
    codepoint: row.codepoint,
    fontMeta: row.fontMeta,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
