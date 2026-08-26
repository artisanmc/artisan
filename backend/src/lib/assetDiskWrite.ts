import { parse, stringify } from "yaml";
import { requestAssetWrite, requestProjectWrite } from "../ws/hub";
import { forgetProjectTree, readProjectTree } from "./projectTreeReads";
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";
import { diskAssetsFromTree, type DiskAsset } from "./diskAssets";

/**
 * Écrire un asset **sur le disque du serveur** (ADR `assets-on-server-disk`, P5).
 *
 * Le backend n'écrit plus rien lui-même : il relaie. Le plugin reste le seul
 * écrivain, comme pour tout le reste du contenu d'un Project.
 *
 * Deux écritures pour un geste — les octets (`asset_write`) puis le descripteur
 * (`project_write`) — parce que le protocole sépare texte et binaire. Elles ne
 * peuvent pas être atomiques ensemble ; l'ordre choisi fait que l'échec le plus
 * probable laisse une image **sans** descripteur (utilisable avec des défauts)
 * plutôt qu'un descripteur sans image (une ligne fantôme dans la bibliothèque).
 */

const DIR_BY_TYPE: Record<string, string> = {
  glyph: "assets/glyphs",
  texture: "assets/textures",
  font: "assets/fonts",
};

/** Nom de fichier = identité. Un nom d'asset est déjà contraint, on le confirme. */
export function assetFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/\.+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
}

export function assetDiskPath(type: string, name: string): string {
  return `${DIR_BY_TYPE[type] ?? "assets"}/${assetFileName(name)}.png`;
}

export interface DiskAssetDescriptor {
  ascent?: number | null;
  codepoint?: number | null;
  width?: number;
  height?: number;
  content_width?: number | null;
}

export function descriptorYaml(d: DiskAssetDescriptor): string {
  const out: Record<string, unknown> = {};
  if (d.ascent !== null && d.ascent !== undefined) out.ascent = d.ascent;
  if (d.codepoint !== null && d.codepoint !== undefined) out.codepoint = d.codepoint;
  if (d.width) out.width = d.width;
  if (d.height) out.height = d.height;
  if (d.content_width !== null && d.content_width !== undefined) out.content_width = d.content_width;
  return stringify(out);
}

/**
 * Le premier codepoint libre de la zone privée, **lu sur le disque**.
 *
 * L'unicité était garantie par un index SQL ; elle devient une proposition de
 * l'éditeur, et la fusion au build tranche les collisions résiduelles (ADR
 * décision 6). Un admin qui édite ses fichiers à la main peut donc en dupliquer
 * un : ça ne casse pas le build, ça se journalise.
 */
export function nextFreeCodepoint(existing: DiskAsset[]): number {
  const used = new Set(
    existing.map((a) => a.row.codepoint).filter((c): c is number => c !== null),
  );
  for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) if (!used.has(cp)) return cp;
  throw new Error(`no free codepoint left in U+E000..U+F7FF`);
}

export interface DiskWriteResult {
  ok: boolean;
  error?: "server_offline" | "conflict" | "write_error" | "name_taken";
  path?: string;
}

export interface DiskAssetsTree {
  assets: DiskAsset[];
  files: { path: string; content: string }[];
  /**
   * Les binaires BRUTS de l'arbre. Distincts de `assets` : les PNG d'une police
   * dépliée n'y sont pas des assets à part entière (c'est la police, l'asset),
   * mais ce sont bien des fichiers, et les supprimer demande leur empreinte.
   */
  binaries: { path: string; hash: string; size: number }[];
}

/**
 * L'état du disque, tel que le serveur l'a lu.
 *
 * L'échec est **qualifié**, et ça n'est pas cosmétique : tant que la table
 * servait de repli, « le serveur n'a pas répondu » et « le Project n'a pas cet
 * asset » pouvaient se confondre sans dommage. Le disque devenu seule source
 * (P6), les confondre ferait lire un serveur éteint comme une bibliothèque
 * vide — et un geste de suppression porterait sur ce vide.
 */
export type DiskAssetsRead =
  | ({ ok: true } & DiskAssetsTree)
  | { ok: false; error: "server_offline" | "read_error" };

export async function readDiskAssets(
  serverKeyId: string,
  diskProjectId: string,
  anchorProjectId: string,
): Promise<DiskAssetsRead> {
  const read = await readProjectTree(serverKeyId, diskProjectId);
  // Muet ou trop lent : dans les deux cas on ne sait pas, et on le dit.
  if (read.kind !== "result") return { ok: false, error: "server_offline" };
  if (!read.result.ok) return { ok: false, error: "read_error" };
  const files = read.result.files ?? [];
  const binaries = read.result.binaries ?? [];
  return {
    ok: true,
    assets: diskAssetsFromTree(anchorProjectId, files, binaries),
    files,
    binaries,
  };
}

export async function writeDiskAsset(
  serverKeyId: string,
  diskProjectId: string,
  input: {
    type: string;
    name: string;
    bytes: Uint8Array;
    descriptor: DiskAssetDescriptor;
    /** Empreinte attendue sur disque — null = « je crée ». */
    baseHash: string | null;
    /** Descripteur déjà présent, pour le compare-and-swap du texte. */
    descriptorBaseHash: string | null;
  },
): Promise<DiskWriteResult> {
  // Notre propre écriture : l'arbre qu'on connaît est déjà faux.
  forgetProjectTree(serverKeyId, diskProjectId);
  const path = assetDiskPath(input.type, input.name);
  const write = await requestAssetWrite(serverKeyId, {
    projectId: diskProjectId,
    files: [{
      path,
      contentBase64: Buffer.from(input.bytes).toString("base64"),
      baseHash: input.baseHash,
    }],
  });
  if (write.kind === "offline") return { ok: false, error: "server_offline" };
  if (write.kind !== "result" || !write.result.ok) {
    return { ok: false, error: write.kind === "result" && write.result.error === "conflict" ? "conflict" : "write_error" };
  }

  const descriptorPath = path.replace(/\.png$/, ".yaml");
  const desc = await requestProjectWrite(serverKeyId, {
    projectId: diskProjectId,
    files: [{
      path: descriptorPath,
      content: descriptorYaml(input.descriptor),
      base_hash: input.descriptorBaseHash,
    }],
  });
  // Les octets sont écrits ; un descripteur qui rate laisse une image
  // utilisable avec des défauts. On le dit, on ne prétend pas que tout va bien.
  if (desc.kind !== "result" || !desc.result.ok) return { ok: false, error: "write_error", path };
  return { ok: true, path };
}

/** Supprime l'asset ET son descripteur — les deux passent par la corbeille. */
export async function deleteDiskAsset(
  serverKeyId: string,
  diskProjectId: string,
  input: { type: string; name: string; baseHash: string; descriptorBaseHash: string | null },
): Promise<DiskWriteResult> {
  // Notre propre écriture : l'arbre qu'on connaît est déjà faux.
  forgetProjectTree(serverKeyId, diskProjectId);
  const path = assetDiskPath(input.type, input.name);
  const write = await requestAssetWrite(serverKeyId, {
    projectId: diskProjectId,
    files: [{ path, contentBase64: null, baseHash: input.baseHash }],
  });
  if (write.kind === "offline") return { ok: false, error: "server_offline" };
  if (write.kind !== "result" || !write.result.ok) {
    return { ok: false, error: write.kind === "result" && write.result.error === "conflict" ? "conflict" : "write_error" };
  }
  if (input.descriptorBaseHash !== null) {
    await requestProjectWrite(serverKeyId, {
      projectId: diskProjectId,
      files: [],
      deletes: [{ path: path.replace(/\.png$/, ".yaml"), base_hash: input.descriptorBaseHash }],
    });
  }
  return { ok: true, path };
}

/** Descripteur courant d'un asset, tel qu'il est sur le disque. */
export function descriptorOf(
  files: { path: string; content: string }[],
  path: string,
): { content: string; parsed: Record<string, unknown> } | null {
  const descriptorPath = path.replace(/\.png$/, ".yaml");
  const file = files.find((f) => f.path === descriptorPath);
  if (!file) return null;
  try {
    const parsed = parse(file.content);
    return { content: file.content, parsed: (parsed ?? {}) as Record<string, unknown> };
  } catch {
    return { content: file.content, parsed: {} };
  }
}

/**
 * Supprime une police DÉPLIÉE : tous ses glyphes et son descripteur.
 *
 * Une police est un dossier, pas un fichier — la supprimer à moitié laisserait
 * des PNG orphelins qu'aucun descripteur ne réclame, invisibles de la
 * bibliothèque et impossibles à retrouver.
 */
export async function deleteDiskFont(
  serverKeyId: string,
  diskProjectId: string,
  input: {
    dir: string;
    /** chemin → empreinte disque des PNG à retirer. */
    glyphs: Record<string, string>;
    descriptorPath: string;
    descriptorBaseHash: string | null;
  },
): Promise<DiskWriteResult> {
  // Notre propre écriture : l'arbre qu'on connaît est déjà faux.
  forgetProjectTree(serverKeyId, diskProjectId);
  const paths = Object.keys(input.glyphs);
  if (paths.length > 0) {
    const write = await requestAssetWrite(serverKeyId, {
      projectId: diskProjectId,
      files: paths.map((path) => ({
        path,
        contentBase64: null,
        baseHash: input.glyphs[path]!,
      })),
    });
    if (write.kind === "offline") return { ok: false, error: "server_offline" };
    if (write.kind !== "result" || !write.result.ok) {
      return {
        ok: false,
        error: write.kind === "result" && write.result.error === "conflict" ? "conflict" : "write_error",
      };
    }
  }
  if (input.descriptorBaseHash !== null) {
    await requestProjectWrite(serverKeyId, {
      projectId: diskProjectId,
      files: [],
      deletes: [{ path: input.descriptorPath, base_hash: input.descriptorBaseHash }],
    });
  }
  return { ok: true, path: input.dir };
}
