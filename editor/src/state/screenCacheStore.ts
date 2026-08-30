import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * **La dernière version connue** d'un écran de Config de module (Catalogue,
 * Réglages…), pour l'afficher sans attendre le serveur.
 *
 * Même raison que pour les Projects : le contenu vit sur le disque du serveur,
 * chaque ouverture demandait trois allers-retours (modèles déclarés, table,
 * modèle voisin) et l'écran restait vide pendant ce temps — pour un contenu
 * presque toujours identique à la visite précédente.
 *
 * Et la même règle, qui n'est pas négociable ici non plus : **ce qui vient du
 * cache est annoncé, et ne s'ÉDITE PAS.** Un écran de Config édite les fichiers
 * du serveur en direct (ADR `module-config-screens`), et l'enregistrement
 * compare ce qu'il croit trouver sur disque. Écrire depuis une copie datée
 * ferait partir un compare-and-swap sur une base fausse : au mieux un conflit,
 * au pire un écrasement. On montre, on attend la revalidation, puis on ouvre.
 */
export interface CachedScreen {
  /** Les fichiers de la table, tels que le serveur les avait rendus. */
  files: { path: string; content: string }[];
  /** Les modèles déclarés du serveur au même instant — sans eux, le formulaire s'ouvrirait sans types. */
  models: unknown[];
  fetchedAt: string;
}

export function screenCacheKey(networkId: string, serverId: string, screenId: string): string {
  return `${networkId}/${serverId}/${screenId}`;
}

interface ScreenCacheState {
  entries: Record<string, CachedScreen>;
  put: (key: string, entry: CachedScreen) => void;
  get: (key: string) => CachedScreen | undefined;
  forget: (key: string) => void;
}

export const useScreenCacheStore = create<ScreenCacheState>()(
  persist(
    (set, get) => ({
      entries: {},
      put: (key, entry) => set((s) => ({ entries: { ...s.entries, [key]: entry } })),
      get: (key) => get().entries[key],
      forget: (key) =>
        set((s) => {
          const { [key]: _dropped, ...rest } = s.entries;
          return { entries: rest };
        }),
    }),
    { name: "artisan.screen-cache" },
  ),
);
