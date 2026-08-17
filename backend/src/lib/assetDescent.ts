import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { assets } from "../db/schema";
import { assetPath } from "./assetStorage";
import { requestAssetWrite, requestProjectRead, requestProjectWrite } from "../ws/hub";

/**
 * La **descente** : les assets du volume backend redescendent sur le disque du
 * serveur, où ils auraient toujours dû être (ADR `assets-on-server-disk`, P3).
 *
 * Idempotente et pilotée par le **hash**, jamais par un drapeau « déjà migré » :
 * un serveur hors ligne au mauvais moment laisse un Project à moitié descendu,
 * et une reprise par curseur repartirait de travers. On rejoue.
 *
 * Elle ne supprime rien côté backend. Tant que P6 n'a pas retiré la table, la
 * ligne reste — c'est ce qui permet de rejouer, et de revenir en arrière si la
 * descente s'avérait fautive.
 */
export interface DescentReport {
  ok: boolean;
  /** Chemins réellement écrits sur le disque du serveur. */
  descended: string[];
  /** Ce qui a résisté, et pourquoi — un silence ici serait un mensonge. */
  failures: { path: string; reason: string }[];
}

const DIR_BY_TYPE: Record<string, string> = {
  glyph: "assets/glyphs",
  texture: "assets/textures",
  font: "assets/fonts",
};

/**
 * Le nom de l'asset devient son nom de fichier — l'identité passe de l'id
 * opaque au nom lisible (ADR décision 2).
 *
 * Un nom venu de notre base ne devrait pas contenir de séparateur, mais un
 * chemin reste un chemin : on l'aplatit plutôt que de faire confiance.
 */
export function targetPathFor(type: string, name: string): string {
  const dir = DIR_BY_TYPE[type] ?? "assets";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/\.+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return `${dir}/${slug || "asset"}.png`;
}

/**
 * Réécrit `asset_id: <id>` en `asset: <nom>` (idem `font_asset_id` → `font`)
 * **dans le texte**, sans reparser.
 *
 * Reparser pour resérialiser mangerait les commentaires et la mise en forme de
 * l'admin — le fichier est à lui, la migration n'a pas à le reformater. Les ids
 * sont opaques et uniques : un remplacement ciblé ne peut pas frapper à côté.
 */
export function rewriteAssetRefs(content: string, byId: Record<string, string>): string {
  let out = content;
  for (const [id, name] of Object.entries(byId)) {
    const quoted = `["']?${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?`;
    out = out.replace(new RegExp(`\\basset_id:\\s*${quoted}`, "g"), `asset: ${name}`);
    out = out.replace(new RegExp(`\\bfont_asset_id:\\s*${quoted}`, "g"), `font: ${name}`);
  }
  return out;
}

/** Descripteur frère : ce que le PNG ne sait pas dire de lui-même. */
function descriptorFor(row: typeof assets.$inferSelect): string {
  const lines = [`# Descripteur de l'asset « ${row.name} ».`];
  if (row.ascent !== null) lines.push(`ascent: ${row.ascent}`);
  if (row.codepoint !== null) lines.push(`codepoint: ${row.codepoint}`);
  if (row.width) lines.push(`width: ${row.width}`);
  if (row.height) lines.push(`height: ${row.height}`);
  if (row.contentWidth !== null) lines.push(`content_width: ${row.contentWidth}`);
  return `${lines.join("\n")}\n`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function descendProjectAssets(
  serverKeyId: string,
  anchorProjectId: string,
  diskProjectId: string,
  opts: { knownBinaries?: Record<string, string> } = {},
): Promise<DescentReport> {
  const rows = await db.select().from(assets).where(eq(assets.projectId, anchorProjectId));
  if (rows.length === 0) return { ok: true, descended: [], failures: [] };

  const failures: DescentReport["failures"] = [];
  const descended: string[] = [];
  const nameById: Record<string, string> = {};
  const descriptors: { path: string; content: string; base_hash: string | null }[] = [];

  // Ce que le disque porte déjà — c'est lui qui dit ce qui reste à faire.
  const known = opts.knownBinaries ?? {};

  for (const row of rows) {
    const path = targetPathFor(row.type, row.name);
    nameById[row.id] = path.slice(path.lastIndexOf("/") + 1).replace(/\.png$/, "");
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(assetPath(row.projectId, row.id)));
    } catch (err) {
      // Une ligne sans octets est une incohérence d'avant la descente : on la
      // signale et on continue, plutôt que d'arrêter toute la migration.
      failures.push({ path, reason: `bytes unreadable: ${(err as Error).message}` });
      continue;
    }
    const hash = sha256(bytes);
    if (known[path] === hash) continue; // déjà descendu, à l'octet près

    const outcome = await requestAssetWrite(serverKeyId, {
      projectId: diskProjectId,
      path,
      contentBase64: Buffer.from(bytes).toString("base64"),
      baseHash: known[path] ?? null,
    });
    if (outcome.kind !== "result" || !outcome.result.ok) {
      failures.push({
        path,
        reason: outcome.kind === "result" ? (outcome.result.error ?? "write_error") : outcome.kind,
      });
      continue;
    }
    descended.push(path);
    descriptors.push({
      path: path.replace(/\.png$/, ".yaml"),
      content: descriptorFor(row),
      base_hash: null,
    });
  }

  // Les descripteurs et la réécriture des refs voyagent dans la MÊME écriture :
  // appliquée à moitié, elle laisserait des menus pointant vers un asset sans
  // descripteur, ou l'inverse.
  const read = await requestProjectRead(serverKeyId, { projectId: diskProjectId });
  if (read.kind !== "result" || !read.result.ok) {
    return { ok: false, descended, failures: [...failures, { path: "*", reason: "project_read failed" }] };
  }
  const files = read.result.files ?? [];
  const rewrites = files
    .map((f) => ({ path: f.path, content: rewriteAssetRefs(f.content, nameById), before: f.content }))
    .filter((f) => f.content !== f.before)
    .map((f) => ({ path: f.path, content: f.content, base_hash: sha256(Buffer.from(f.before, "utf8")) }));

  const pending = [
    ...descriptors.filter((d) => !files.some((f) => f.path === d.path)),
    ...rewrites,
  ];
  if (pending.length > 0) {
    const write = await requestProjectWrite(serverKeyId, {
      projectId: diskProjectId,
      files: pending.map((f) => ({ path: f.path, content: f.content, base_hash: f.base_hash })),
    });
    if (write.kind !== "result" || !write.result.ok) {
      return {
        ok: false,
        descended,
        failures: [...failures, { path: "*", reason: "project_write failed" }],
      };
    }
  }

  return { ok: failures.length === 0, descended, failures };
}
