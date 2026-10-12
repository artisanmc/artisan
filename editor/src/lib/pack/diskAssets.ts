import { parse } from "yaml";
import { sha256Hex } from "../sha256";
import { parseAssetUsages } from "./assetUsages";
import { FONT_DESCRIPTOR, FONT_DIR, fontFromDisk } from "./fontOnDisk";
import type { AssetRow } from "./resourcePackBuilder";

/**
 * Les assets d'un Project **lus sur le disque du serveur** (ADR
 * `assets-on-server-disk`, P4).
 *
 * Rend la même forme que les lignes de la table `assets` — c'est ce que le
 * constructeur de resource pack attend, et le but de cette phase est de changer
 * la SOURCE sans toucher au reste. La table part en P6.
 *
 * L'identité d'un asset est son **nom de fichier** : `assets/glyphs/diamant.png`
 * devient l'asset `diamant`. Son descripteur frère (`diamant.yaml`) porte ce que
 * le PNG ne sait pas dire — ascent, codepoint, largeur de contenu. Un asset sans
 * descripteur reste utilisable avec des défauts : une faute de frappe dans un
 * `.yaml` ne doit pas faire disparaître une image (règle des fichiers data nus).
 */
export interface DiskAsset {
  row: AssetRow;
  path: string;
  hash: string;
}

const TYPE_BY_DIR: Record<string, string> = {
  "assets/glyphs": "glyph",
  "assets/textures": "texture",
};

function typeOf(path: string): string | null {
  const dir = path.slice(0, path.lastIndexOf("/"));
  return TYPE_BY_DIR[dir] ?? null;
}

function nameOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[^.]+$/, "");
}

function sha256(content: string): string {
  return sha256Hex(new TextEncoder().encode(content));
}

function num(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Assemble les assets d'un Project depuis l'arbre annoncé par le serveur.
 *
 * `binaries` porte les chemins et les empreintes ; `files` porte les
 * descripteurs. Aucun octet ne circule ici — les octets se demandent asset par
 * asset, à qui en a besoin (côté backend : `readDiskAssetBytes`).
 */
export function diskAssetsFromTree(
  anchorProjectId: string,
  files: { path: string; content: string }[],
  binaries: { path: string; hash: string; size: number }[],
): DiskAsset[] {
  const descriptors = new Map<string, Record<string, unknown>>();
  for (const f of files) {
    if (!f.path.startsWith("assets/") || !f.path.endsWith(".yaml")) continue;
    try {
      const parsed = parse(f.content);
      if (parsed && typeof parsed === "object") {
        descriptors.set(f.path.replace(/\.yaml$/, ""), parsed as Record<string, unknown>);
      }
    } catch {
      // Descripteur illisible : l'image reste utilisable avec des défauts. La
      // faire disparaître pour une faute de frappe punirait la mauvaise chose.
    }
  }

  const out: DiskAsset[] = [];

  // Une POLICE est un dossier, pas un fichier : `assets/fonts/<nom>/font.yaml`
  // plus un PNG par glyphe. C'est elle l'asset — sans ça, la bibliothèque
  // afficherait 95 « glyphes » nommés a, b, c… à côté d'elle.
  for (const f of files) {
    if (!f.path.startsWith(`${FONT_DIR}/`) || !f.path.endsWith(`/${FONT_DESCRIPTOR}`)) continue;
    const dir = f.path.slice(0, -(FONT_DESCRIPTOR.length + 1));
    const name = dir.slice(dir.lastIndexOf("/") + 1);
    const meta = fontFromDisk(f.content);
    if (!meta) continue; // descripteur illisible : on n'invente pas de police
    const now = new Date();
    out.push({
      path: f.path,
      // Le hash d'une police, c'est celui de son descripteur : c'est lui qui
      // change quand on ajoute, retire ou déplace un glyphe.
      hash: sha256(f.content),
      row: {
        id: name,
        projectId: anchorProjectId,
        type: "font",
        name,
        width: 0,
        height: 0,
        ascent: null,
        codepoint: null,
        contentWidth: null,
        fontMeta: meta as unknown as AssetRow["fontMeta"],
        contentHash: sha256(f.content),
        createdAt: now,
        updatedAt: now,
      } as AssetRow,
    });
  }

  for (const bin of binaries) {
    const type = typeOf(bin.path);
    if (type === null) continue; // hors des dossiers d'assets : pas notre affaire
    const meta = descriptors.get(bin.path.replace(/\.[^.]+$/, "")) ?? {};
    const now = new Date();
    out.push({
      path: bin.path,
      hash: bin.hash,
      row: {
        id: nameOf(bin.path),
        projectId: anchorProjectId,
        type,
        name: nameOf(bin.path),
        usages: parseAssetUsages(meta.usages),
        width: num(meta.width, 0) ?? 0,
        height: num(meta.height, 0) ?? 0,
        ascent: num(meta.ascent, null),
        codepoint: num(meta.codepoint, null),
        contentWidth: num(meta.content_width, null),
        fontMeta: (meta.font_meta as AssetRow["fontMeta"]) ?? null,
        contentHash: bin.hash,
        createdAt: now,
        updatedAt: now,
      } as AssetRow,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
