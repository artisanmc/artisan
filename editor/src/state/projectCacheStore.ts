import type { FailedDocument } from "@/lib/api/projectFiles";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * **La dernière version connue** d'un Project : l'arbre que le serveur nous a
 * rendu la fois d'avant, avec de quoi le reconstruire sans réseau.
 *
 * Pourquoi ça existe : le contenu vit sur le disque du serveur (ADR
 * `server-disk-only-storage`), donc l'ouvrir demande un aller-retour jusqu'au
 * plugin — plusieurs secondes, pour un contenu presque toujours identique à la
 * visite précédente. On affiche ce qu'on avait, tout de suite, et on revalide
 * derrière.
 *
 * Ce que ce cache n'est PAS, et ne doit jamais devenir :
 *
 * - **une vérité** — le disque du serveur l'est. Ce qui vient d'ici s'affiche
 *   marqué (`stale`), jamais en se faisant passer pour frais. C'est la même
 *   règle que les brouillons, pour la même raison : un état daté présenté comme
 *   courant fait travailler l'admin sur ce qu'il ne voit pas.
 * - **un brouillon** — un brouillon porte MES modifications non enregistrées
 *   (`projectDraftStore`) ; ce cache porte ce que LE SERVEUR avait. Les deux
 *   coexistent : on peut avoir un cache sans brouillon (Project seulement
 *   consulté), et le brouillon garde sa propre base de compare-and-swap.
 *
 * Il ne sert jamais de base au compare-and-swap : celle-ci reste ce que le
 * serveur a rendu à l'ouverture (`projectBaselineStore`). Enregistrer depuis un
 * cache périmé écraserait ce qui a changé entre-temps.
 */
export interface CachedProject {
  /** L'identité rendue par le backend — de quoi rebâtir le Project hors ligne. */
  identity: unknown;
  /** Id du dossier sur le disque du serveur. */
  diskId: string;
  /**
   * Le serveur propriétaire, par son id INTERNE.
   *
   * La clé d'entrée, elle, porte ce que l'URL présente (un slug, parfois un
   * id) : elle ne peut donc pas servir à reconnaître un Project annoncé par le
   * plugin, qui ne connaît que les ids. D'où ce champ.
   */
  serverKeyId?: string | null;
  /** L'arbre rel-keyed, tel que le serveur l'a rendu. */
  tree: Record<string, string>;
  /** Documents que le serveur n'avait pas su charger, à réafficher tels quels. */
  failed?: FailedDocument[];
  /**
   * L'empreinte que le serveur a rendue avec cet arbre. On la lui redonne à la
   * visite suivante (`if_hash`) : s'il porte la même, il ne renvoie rien.
   * Calculée par le plugin seul — on ne fait que la conserver.
   */
  hash?: string | null;
  /** Quand — un cache sans date ne peut pas s'annoncer daté. */
  fetchedAt: string;
}

/**
 * La clé d'une entrée. L'URL peut porter un slug OU un id, et le même nom peut
 * exister sur deux serveurs : la clé porte donc les deux, telles qu'elles se
 * présentent, sans résolution — résoudre demanderait le réseau qu'on cherche
 * justement à éviter.
 */
export function projectCacheKey(projectId: string, serverRef?: string | null): string {
  return `${serverRef ?? ""}/${projectId}`;
}

interface ProjectCacheState {
  entries: Record<string, CachedProject>;
  /**
   * Bumpé par le geste « Actualiser ». Le chargeur en dépend, donc le relire
   * relance une vraie lecture du disque — la seule façon, pour l'admin, de
   * demander explicitement la version du serveur (les modifications faites à la
   * main sur le disque ne sont prises en compte qu'au reload du plugin).
   */
  reloadToken: number;
  requestReload: () => void;
  put: (key: string, entry: CachedProject) => void;
  get: (key: string) => CachedProject | undefined;
  forget: (key: string) => void;
}

export const useProjectCacheStore = create<ProjectCacheState>()(
  persist(
    (set, get) => ({
      entries: {},
      reloadToken: 0,
      requestReload: () => set((s) => ({ reloadToken: s.reloadToken + 1 })),
      put: (key, entry) => set((s) => ({ entries: { ...s.entries, [key]: entry } })),
      get: (key) => get().entries[key],
      forget: (key) =>
        set((s) => {
          const { [key]: _dropped, ...rest } = s.entries;
          return { entries: rest };
        }),
    }),
    {
      name: "artisan.project-cache",
      // Le jeton d'actualisation est un geste, pas un état : le persister
      // ferait relire au prochain démarrage pour une raison périmée.
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);
