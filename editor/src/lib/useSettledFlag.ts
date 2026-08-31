import { useEffect, useState } from "react";

/**
 * Au-delà de quoi une revalidation EN COURS mérite d'être annoncée.
 *
 * Généreux à dessein. Une revalidation qui aboutit — même en une seconde et
 * demie — n'a rien à signaler : le contenu affiché est celui de la visite
 * précédente, il sera remplacé, et prévenir dans cet intervalle ne fait que
 * clignoter. Ce qui mérite un avis, c'est l'attente qui s'installe : à ce
 * moment-là, l'utilisateur se demande à juste titre ce qu'il regarde.
 *
 * Le cas VRAIMENT à risque n'est pas celui-ci — c'est l'échec, où l'écran peut
 * rester daté indéfiniment. Celui-là s'annonce sans délai (cf. les appelants).
 */
export const STALE_NOTICE_DELAY_MS = 3_000;

/**
 * Vrai seulement quand [flag] l'est resté [delayMs] d'affilée.
 *
 * Sert aux avertissements qui ne valent que s'ils durent. Un affichage daté qui
 * se corrige en 200 ms n'a besoin de prévenir personne : le bandeau
 * apparaîtrait et disparaîtrait avant d'être lu, et cette agitation coûte plus
 * d'attention qu'elle n'en informe. S'il s'attarde — serveur lent, hors ligne —
 * alors il faut le dire, et la règle tient : un état daté ne reste jamais
 * silencieux.
 *
 * Retombe à faux immédiatement : ce qui n'est plus vrai s'efface sans délai.
 */
export function useSettledFlag(flag: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!flag) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(timer);
  }, [flag, delayMs]);

  return settled;
}
