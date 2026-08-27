import { isDirty } from "@/features/project/draft";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

/**
 * Ce que l'éditeur fait d'un rechargement annoncé par le plugin.
 *
 * Le plugin relit ses Projects sur `/artisan reload` (et sur ses propres
 * écritures) : c'est le seul moment où une édition faite à la main sur le disque
 * devient réelle. Sans cette annonce, l'éditeur gardait sa dernière version
 * connue jusqu'à ce que quelqu'un pense à actualiser.
 *
 * La conduite tenue ici est délibérément timide :
 *
 * - **On ne relit que si l'empreinte annoncée diffère** de celle qu'on détient.
 *   Un reload qui ne change rien pour nous ne doit rien coûter.
 * - **On ne touche à rien s'il existe un brouillon sale, où que ce soit.** Il
 *   n'existe nulle part ailleurs, et le remplacer sans rien demander serait
 *   faire dans le dos de l'admin ce que le bouton Actualiser lui fait
 *   confirmer. La question « lequel est ouvert ? » n'a délibérément pas été
 *   posée : l'URL porte parfois un slug là où le brouillon porte un id interne,
 *   et se tromper de rapprochement ferait écraser du travail. S'abstenir de
 *   trop, ici, ne coûte qu'un clic sur Actualiser.
 */
export function onProjectsReloaded(
  serverKeyId: string,
  projects: { id: string; hash: string }[],
): void {
  const cache = useProjectCacheStore.getState();
  const dirtySomewhere = Object.values(useProjectDraftStore.getState().drafts).some((d) =>
    isDirty(d.initialTree, d.tree),
  );
  if (dirtySomewhere) return;

  // Le plugin ne connaît que les ids ; nos clés portent ce que l'URL présente
  // (souvent un slug). On reconnaît donc une version connue par son serveur et
  // son id disque, pas par sa clé.
  const known = Object.values(cache.entries);
  for (const p of projects) {
    const mine = known.find((e) => e.serverKeyId === serverKeyId && e.diskId === p.id);
    if (!mine) continue;
    if (mine.hash && mine.hash === p.hash) continue;
    cache.requestReload();
    return;
  }
}
