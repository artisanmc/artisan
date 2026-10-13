import type { TFunction } from "i18next";
import { toast } from "sonner";

/**
 * Éditeur auto-hébergé : après une écriture sur le disque, reconstruit le resource
 * pack dans le navigateur et l'envoie au plugin, sans bloquer la publication. Un
 * échec laisse le pack précédent en place et se signale par un toast. L'appelant
 * garde l'appel derrière `SELF_HOSTED` ; le constructeur n'est chargé qu'à ce moment.
 * Serveur inconnu : rien n'est reconstruit, plutôt que le pack d'un autre serveur.
 */
export function rebuildServerPackInBackground(
  t: TFunction,
  serverId: string | null | undefined,
): void {
  if (!serverId) return;
  void import("@/lib/pack/buildServerPack")
    .then(({ requestResourcePackRebuild }) => requestResourcePackRebuild(serverId))
    .catch((error: unknown) => {
      console.warn("[resource-pack]", error);
      toast.error(t("deploy.packFailed"), { id: "resource-pack-rebuild" });
    });
}
