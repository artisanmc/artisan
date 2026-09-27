import { Button } from "@/components/ui/button";
import { ChangeList } from "@/components/ui/change-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  copyPersistedDraft,
  refreshPersistedDraftList,
  selectPersistedDraft,
  usePersistedDraftStore,
} from "./persistedDrafts";
import { ProjectVersions } from "./ProjectVersions";

export function PersistedDraftControls({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const session = usePersistedDraftStore((s) => s.sessions[projectId]);
  const local = useProjectDraftStore((s) => s.drafts[projectId]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  if (!session) return null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(t("drafts.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("drafts.title")}</DialogTitle>
          <DialogDescription>{t("drafts.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[18rem_minmax(0,1fr)] lg:overflow-hidden">
          <aside className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
            <output className="text-sm text-[var(--text-mut)]">
              {t(`drafts.${session.status}`)}
            </output>
            <div className="flex items-center justify-between gap-2">
              <h3 className="field-label">{t("drafts.list")}</h3>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => refreshPersistedDraftList(projectId))}
              >
                {t("drafts.refresh")}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {session.drafts.map((draft) => (
                <div className="card flex items-center justify-between gap-2 p-2" key={draft.id}>
                  <span className="truncate text-sm">{draft.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy || draft.id === local?.remote?.id || session.status === "conflict"
                    }
                    onClick={() =>
                      void run(async () => {
                        await selectPersistedDraft(projectId, draft.id);
                        useProjectCacheStore.getState().requestReload();
                        onOpenChange(false);
                      })
                    }
                  >
                    {draft.id === local?.remote?.id ? t("drafts.current") : t("drafts.open")}
                  </Button>
                </div>
              ))}
            </div>
            <label htmlFor={nameId} className="flex flex-col gap-1">
              <span className="field-label">{t("drafts.name")}</span>
              <Input
                id={nameId}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || !local || !name.trim()}
              onClick={() =>
                void run(async () => {
                  await copyPersistedDraft(projectId, name.trim());
                  setName("");
                })
              }
            >
              {t("drafts.copy")}
            </Button>
            <ProjectVersions projectId={projectId} onRestored={() => onOpenChange(false)} />
          </aside>
          <section className="flex min-h-0 min-w-0 flex-col gap-2 lg:overflow-y-auto">
            <h3 className="field-label">{t("drafts.changes")}</h3>
            <ChangeList
              before={local?.baseline ?? {}}
              after={local?.tree ?? {}}
              renames={local?.renames}
              binaryBefore={local?.binaryBaseline}
              binaryAfter={local?.binaryTree}
              beforeLabel={t("drafts.before")}
              afterLabel={t("drafts.after")}
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
