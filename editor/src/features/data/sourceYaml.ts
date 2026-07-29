import type { DataSource, Project } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { projectFromFiles } from "@/schema/projectFromFiles";

export interface SourceFile {
  path: string;
  content: string;
}

const base = (pack: Project) => `plugins/Artisan/projects/${pack.id}/`;

/** Les chemins qui appartiennent à cette source : son fichier data (ou son
 *  dossier par-row) et son schéma beside. */
function ownsPath(rel: string, sourceId: string): boolean {
  return (
    rel === `data/${sourceId}.yaml` ||
    rel.startsWith(`data/${sourceId}/`) ||
    rel === `models/${sourceId}.yaml`
  );
}

/**
 * Les fichiers d'une source, tels que le writer canonique les émettrait —
 * c'est ce que l'onglet YAML montre et édite (ADR `yaml-assisted-editing` ⑦/⑧).
 */
export function sourceYamlFiles(pack: Project, source: DataSource): SourceFile[] {
  const emitted = transform(pack);
  const prefix = base(pack);
  return Object.entries(emitted)
    .filter(([full]) => full.startsWith(prefix) && ownsPath(full.slice(prefix.length), String(source.id)))
    .map(([full, content]) => ({ path: full.slice(prefix.length), content }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Réinjecte le YAML édité dans le project : le texte est reparsé par le même
 * importeur que le chargement, et **seules** les données en sortent — menus,
 * dialogs et mise en page ne sont pas touchés par une édition de source.
 *
 * Renvoie null si le YAML ne parse pas en un project exploitable : l'appelant
 * garde alors l'état courant (l'éditeur laisse le texte cassé enregistrable,
 * mais ne détruit pas le domaine avec).
 */
export function applySourceYaml(pack: Project, edited: SourceFile[]): Project | null {
  const files: Record<string, string> = { ...transform(pack) };
  const prefix = base(pack);
  // Un fichier supprimé de l'ensemble édité disparaît aussi du project.
  const editedPaths = new Set(edited.map((f) => prefix + f.path));
  for (const path of Object.keys(files)) {
    if (editedPaths.has(path)) continue;
  }
  for (const f of edited) files[prefix + f.path] = f.content;

  const reparsed = projectFromFiles(pack.id, files, {
    name: pack.name,
    slug: pack.slug,
    serverKeyId: pack.serverKeyId,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
  });
  if (!reparsed) return null;

  return {
    ...pack,
    dataSources: reparsed.dataSources,
    dataModels: reparsed.dataModels,
    // Les valeurs ltext du fichier peuvent minter/adopter des clés : la table
    // de traduction suit, sinon les textes réapparaîtraient vides.
    i18nKeys: reparsed.i18nKeys,
  };
}
