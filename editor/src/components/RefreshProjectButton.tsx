import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectId } from "@/domain/types";
import { isDirty } from "@/features/project/draft";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Relire le Project sur le disque de son serveur, à la demande.
 *
 * Il existe parce que l'éditeur affiche d'abord la dernière version connue
 * (`projectCacheStore`) et parce qu'une modification faite à la main sur le
 * disque n'est prise en compte qu'au reload du plugin : il faut donc un geste
 * pour dire « va vraiment voir ». Sans lui, la seule issue serait de recharger
 * la page en espérant.
 *
 * Avec du travail non enregistré, il ÉCRASE — c'est ce qu'on attend d'un
 * rafraîchissement — mais jamais sans le demander : ce qui est perdu ici ne se
 * retrouve nulle part.
 */
export function RefreshProjectButton({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const dirty = draft ? isDirty(draft.initialTree, draft.tree) : false;
  const [confirming, setConfirming] = useState(false);

  const refresh = () => {
    // Le brouillon disparaît AVANT la relecture : le laisser ferait reprendre
    // l'arbre local par-dessus ce qu'on vient d'aller chercher.
    useProjectDraftStore.getState().clear(projectId);
    useProjectCacheStore.getState().requestReload();
    setConfirming(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("topbar.refresh")}
        title={t("topbar.refresh")}
        onClick={() => (dirty ? setConfirming(true) : refresh())}
      >
        <RefreshCw className="size-[15px]" />
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("topbar.refreshConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("topbar.refreshConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("topbar.refreshCancel")}
            </Button>
            <Button variant="destructive" onClick={refresh}>
              {t("topbar.refreshConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
