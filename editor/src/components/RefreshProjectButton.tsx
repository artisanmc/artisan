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
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Re-reads the Project from its server's disk, on demand.
 *
 * It exists because the editor first shows the last known version
 * (`projectCacheStore`) and because a manual change on disk is only picked up
 * when the plugin reloads: a gesture is needed to say "really go and look".
 *
 * With unsaved work it OVERWRITES — which is what a refresh is expected to do —
 * but never without asking: what is lost here cannot be found anywhere else.
 */
export function RefreshProjectButton({
  projectId,
  renderTrigger,
}: { projectId: ProjectId; renderTrigger?: (refresh: () => void) => ReactNode }) {
  const { t } = useTranslation();
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const dirty = draft ? isDirty(draft.initialTree, draft.tree) : false;
  const [confirming, setConfirming] = useState(false);

  const refresh = () => {
    // The draft goes BEFORE the re-read: keeping it would reapply the local tree
    // on top of what was just fetched.
    useProjectDraftStore.getState().clear(projectId);
    useProjectCacheStore.getState().requestReload();
    setConfirming(false);
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => (dirty ? setConfirming(true) : refresh()))
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("topbar.refresh")}
          title={t("topbar.refresh")}
          onClick={() => (dirty ? setConfirming(true) : refresh())}
        >
          <RefreshCw className="size-[15px]" />
        </Button>
      )}

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
