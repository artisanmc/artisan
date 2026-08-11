import type { PreviewCallContext } from "./previewCallContexts";

/**
 * Navigation d'un **Preview context** à l'autre.
 *
 * Un menu paramétré est un document pour N écrans : ses Placements portent
 * toutes les catégories à la fois, et un même slot a un occupant différent selon
 * le contexte regardé (ADR `parameterised-menu-over-menu-per-category`). Passer
 * d'un contexte au suivant est donc le geste d'édition central — d'où deux
 * points d'entrée partagés : l'arête du board et le bandeau du menu.
 */

/** L'index du contexte actuellement posé, ou -1. */
export function currentCallIndex(
  contexts: PreviewCallContext[],
  previewArgs: Record<string, unknown> | undefined,
): number {
  const args = previewArgs ?? {};
  return contexts.findIndex((c) =>
    // TOUS les arguments doivent correspondre : une correspondance partielle
    // donnerait un écran hybride qui ne correspond à aucun appel réel.
    Object.entries(c.args).every(([k, v]) => JSON.stringify(args[k] ?? "") === JSON.stringify(v)),
  );
}

/**
 * Le contexte suivant, en boucle. [from] restreint aux appels venus de ce menu :
 * cliquer l'arête `shop_main → shop_category` fait défiler les catégories sans
 * sauter sur un appel venu d'ailleurs.
 */
export function nextCallContext(
  contexts: PreviewCallContext[],
  previewArgs: Record<string, unknown> | undefined,
  from?: string,
): PreviewCallContext | null {
  const pool = from ? contexts.filter((c) => c.from === from) : contexts;
  if (pool.length === 0) return null;
  const current = currentCallIndex(pool, previewArgs);
  return pool[(current + 1) % pool.length] ?? null;
}
