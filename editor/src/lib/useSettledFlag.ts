import { useEffect, useState } from "react";

/**
 * Au-delà de quoi une attente mérite d'être annoncée. Assez long pour que le
 * cas nominal (revalidation en quelques centaines de ms) reste muet, assez
 * court pour qu'un vrai délai ne passe pas pour de l'immobilisme.
 */
export const STALE_NOTICE_DELAY_MS = 600;

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
