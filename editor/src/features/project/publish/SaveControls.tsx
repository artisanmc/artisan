import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SaveFilledIcon } from "@/components/ui/filled-icons";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { ProjectId } from "@/domain/types";
import { DeployReviewDialog } from "@/features/project/DeployReviewDialog";
import { PersistedDraftControls } from "@/features/project/PersistedDraftControls";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cx";
import { ChevronDown, Play } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConflictResolutionDialog } from "./ConflictResolutionDialog";
import { usePublishFlow } from "./usePublishFlow";

/**
 * Two gestures, two destinations:
 * - Save pushes the draft (which also syncs on its own);
 * - Deploy, the only gesture that writes to the server's disk (ADR
 *   `server-disk-only-storage`), first goes through a diff review.
 *
 * The view only: the workflow (CAS write, conflicts, review) is `usePublishFlow`.
 */
export function SaveControls({
  projectId,
  offline = false,
}: {
  projectId: ProjectId;
  /** The server is offline: the draft stays editable, publishing waits for its return. */
  offline?: boolean;
}) {
  const { t } = useTranslation();
  const flow = usePublishFlow(projectId, offline);
  const { state, draftSession, dirty, canSave, draftBusy, draftSaved, draftNeedsAttention } = flow;
  const [draftsOpen, setDraftsOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {draftSession && (
          <Tooltip content={t(`drafts.tooltip.${draftBusy ? "saving" : draftSession.status}`)}>
            <button
              type="button"
              onClick={flow.saveDraft}
              aria-disabled={draftBusy || draftSaved}
              aria-busy={draftBusy}
              aria-label={
                draftBusy
                  ? t("save.saving")
                  : draftSaved
                    ? t("drafts.savedShort")
                    : t("drafts.save")
              }
              className={cn(
                "btn btn-sm btn-ghost btn-icon",
                (draftBusy || draftSaved) && "cursor-default opacity-50",
              )}
            >
              {draftBusy ? (
                <Spinner aria-hidden role="presentation" className="text-current" />
              ) : (
                <SaveFilledIcon aria-hidden />
              )}
            </button>
          </Tooltip>
        )}
        {offline ? (
          // A disabled button gets no hover: `aria-disabled` keeps the explanation reachable.
          <Tooltip content={t("deploy.offline")}>
            <button
              type="button"
              aria-disabled
              onClick={flow.openReview}
              className="btn btn-sm btn-primary cursor-default opacity-50"
            >
              <Play className="size-4" fill="currentColor" aria-hidden />
              {t("deploy.deploy")}
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={flow.openReview}
            disabled={state.saving || !canSave || !dirty}
            title={
              !canSave
                ? t("deploy.cannotDeployTitle")
                : dirty
                  ? t("deploy.deployTitle")
                  : t("deploy.nothing")
            }
            className="btn btn-sm btn-primary"
          >
            {state.saving ? (
              <Spinner aria-hidden role="presentation" className="text-current" />
            ) : (
              <Play className="size-4" fill="currentColor" aria-hidden />
            )}
            {state.saving ? t("deploy.deploying") : t("deploy.deploy")}
          </button>
        )}
        {dirty || draftSession || state.lastError ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={
                draftNeedsAttention
                  ? `${t("save.options")} — ${t(`drafts.${draftSession?.status}`)}`
                  : t("save.options")
              }
              title={draftNeedsAttention ? t(`drafts.${draftSession?.status}`) : t("save.options")}
              className="btn btn-sm btn-ghost relative px-2"
            >
              <ChevronDown className="size-4" />
              {draftNeedsAttention && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--danger)]"
                />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {state.lastError && (
                <DropdownMenuItem onSelect={() => flow.setErrorOpen(true)}>
                  {t("save.lastError")}
                </DropdownMenuItem>
              )}
              {draftSession && (
                <DropdownMenuItem onSelect={() => setDraftsOpen(true)}>
                  {t("drafts.title")}
                </DropdownMenuItem>
              )}
              {draftSession && dirty && <DropdownMenuSeparator />}
              {dirty && (
                <DropdownMenuItem
                  className="text-[var(--danger)]"
                  title={t("draft.revertTitle")}
                  onSelect={flow.discardChanges}
                >
                  {t("save.discardChanges")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <DeployReviewDialog
        changes={state.review?.changes ?? null}
        checks={state.review?.checks}
        onCancel={flow.closeReview}
        onConfirm={flow.confirmReview}
      />
      <PersistedDraftControls
        projectId={projectId}
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
      />
      <SaveErrorDialog
        details={state.lastError}
        open={state.errorOpen}
        onOpenChange={flow.setErrorOpen}
      />
      <ConflictResolutionDialog
        conflict={state.conflict}
        onChoose={flow.chooseConflict}
        onClose={flow.closeConflicts}
        onApply={flow.applyConflicts}
      />
    </>
  );
}

function SaveErrorDialog({
  details,
  open,
  onOpenChange,
}: {
  details: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deploy.failed")}</DialogTitle>
          <DialogDescription>{t("save.errorHelp")}</DialogDescription>
        </DialogHeader>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-[var(--text)]">
          {details}
        </pre>
        <DialogFooter>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("save.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={async () => {
              try {
                await copyText(details ?? "");
                toast.success(t("save.copied"));
              } catch {
                toast.error(t("save.copyFailed"));
              }
            }}
          >
            {t("save.copyDetails")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
