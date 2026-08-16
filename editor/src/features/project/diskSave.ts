import { hashContent } from "@/lib/contentHash";

/**
 * Planification de l'enregistrement sur le disque du serveur (ADR
 * `server-disk-only-storage`, P2).
 *
 * L'éditeur conserve la **base** — le contenu de chaque fichier tel qu'il l'a
 * chargé. Enregistrer ne pousse pas l'arbre entier : on compare à la base, on
 * n'envoie que le delta, et chaque entrée porte le hash de sa base pour que le
 * plugin refuse si le disque a bougé entre-temps. Un fichier que personne n'a
 * touché n'est jamais réécrit, donc ne peut jamais entrer en conflit.
 */

export interface PlannedWrite {
  path: string;
  content: string;
  /** Hash du contenu attendu sur disque ; `null` = « il ne devait pas y en avoir ». */
  base_hash: string | null;
}

export interface PlannedDelete {
  path: string;
  base_hash: string | null;
}

export interface WritePlan {
  files: PlannedWrite[];
  deletes: PlannedDelete[];
  /** Rien à enregistrer — l'appelant peut s'épargner l'aller-retour. */
  empty: boolean;
}

/** Contenus rel-keyed → plan d'écriture minimal, chemins triés. */
export async function planWrite(
  baseline: Record<string, string>,
  next: Record<string, string>,
): Promise<WritePlan> {
  const files: PlannedWrite[] = [];
  for (const path of Object.keys(next).sort()) {
    const content = next[path]!;
    const before = baseline[path];
    if (before === content) continue;
    files.push({
      path,
      content,
      // Le jeton décrit ce qu'on croyait trouver sur disque, donc il se calcule
      // sur la BASE et jamais sur le nouveau contenu.
      base_hash: before === undefined ? null : await hashContent(before),
    });
  }

  const deletes: PlannedDelete[] = [];
  for (const path of Object.keys(baseline).sort()) {
    if (path in next) continue;
    deletes.push({ path, base_hash: await hashContent(baseline[path]!) });
  }

  return { files, deletes, empty: files.length === 0 && deletes.length === 0 };
}

/**
 * `transform()` produit des chemins canoniques
 * (`plugins/Artisan/projects/<diskId>/<rel>`) ; le protocole plugin parle en
 * chemins relatifs au project. Ce qui n'appartient pas au project est écarté —
 * une écriture ne sort jamais de son propre arbre.
 */
export function toRelative(
  canonical: Record<string, string>,
  diskId: string,
): Record<string, string> {
  const prefix = `plugins/Artisan/projects/${diskId}/`;
  const out: Record<string, string> = {};
  for (const [key, content] of Object.entries(canonical)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = content;
  }
  return out;
}

/**
 * Transforme un « supprimer l'ancien + créer le nouveau » en **déplacement**,
 * quand l'éditeur a déclaré un renommage.
 *
 * L'arbre seul ne peut pas distinguer les deux, mais l'éditeur, lui, sait. Sans
 * cette traduction, renommer un Document archive une suppression qui n'en est
 * pas une et laisse son historique orphelin du nouveau nom.
 *
 * Le `base_hash` du déplacement porte sur l'ANCIEN chemin — c'est lui que le
 * serveur doit retrouver intact. Et si le contenu a aussi changé, l'écriture qui
 * suit se base sur ce même contenu, puisque le fichier déplacé le porte encore.
 */
export async function applyRenames(
  plan: WritePlan,
  renames: { from: string; to: string }[],
  baseline: Record<string, string>,
): Promise<WritePlan & { renames: { from: string; to: string; base_hash: string }[] }> {
  const applied: { from: string; to: string; base_hash: string }[] = [];
  let files = plan.files;
  let deletes = plan.deletes;

  for (const { from, to } of renames) {
    const was = baseline[from];
    // Un renommage dont la source n'est pas dans la base ne décrit rien que le
    // serveur puisse vérifier : on le laisse retomber en création normale.
    if (was === undefined) continue;
    applied.push({ from, to, base_hash: await hashContent(was) });
    // L'ancien chemin ne se supprime plus : il se déplace.
    deletes = deletes.filter((d) => d.path !== from);
    files = files.map((f) =>
      // Après le déplacement, la destination porte l'ancien contenu : c'est LUI
      // que le compare-and-swap doit attendre, pas « aucun fichier ».
      f.path === to ? { ...f, base_hash: applied[applied.length - 1]!.base_hash } : f,
    );
    // Contenu inchangé : le déplacement suffit, rien à réécrire.
    const target = files.find((f) => f.path === to);
    if (target && target.content === was) files = files.filter((f) => f.path !== to);
  }

  return {
    files,
    deletes,
    renames: applied,
    empty: files.length === 0 && deletes.length === 0 && applied.length === 0,
  };
}
