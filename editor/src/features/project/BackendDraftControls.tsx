import { Button } from "@/components/ui/button";
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
  copyBackendDraft,
  refreshBackendDraftList,
  selectBackendDraft,
  useBackendDraftStore,
} from "./backendDrafts";

export function BackendDraftControls({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const session = useBackendDraftStore((s) => s.sessions[projectId]);
  const local = useProjectDraftStore((s) => s.drafts[projectId]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  if (!session) return null;
  const paths = [
    ...new Set([...Object.keys(local?.baseline ?? {}), ...Object.keys(local?.tree ?? {})]),
  ]
    .filter((path) => local?.baseline[path] !== local?.tree[path])
    .sort();
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("drafts.title")}</DialogTitle>
            <DialogDescription>{t("drafts.description")}</DialogDescription>
          </DialogHeader>
          <output className="text-sm text-[var(--text-mut)]">
            {t(`drafts.${session.status}`)}
          </output>
          <div className="flex items-end gap-2">
            <label htmlFor={nameId} className="flex flex-1 flex-col gap-1">
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
                  await copyBackendDraft(projectId, name.trim());
                  setName("");
                })
              }
            >
              {t("drafts.copy")}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => refreshBackendDraftList(projectId))}
          >
            {t("drafts.refresh")}
          </Button>
          <div className="max-h-[55vh] space-y-3 overflow-auto">
            {session.drafts.map((draft) => (
              <div className="card flex items-center justify-between gap-2 p-2" key={draft.id}>
                <span className="truncate">{draft.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || draft.id === local?.remote?.id || session.status === "conflict"}
                  onClick={() =>
                    void run(async () => {
                      await selectBackendDraft(projectId, draft.id);
                      useProjectCacheStore.getState().requestReload();
                      onOpenChange(false);
                    })
                  }
                >
                  {draft.id === local?.remote?.id ? t("drafts.current") : t("drafts.open")}
                </Button>
              </div>
            ))}
            <h3 className="field-label">{t("drafts.changes")}</h3>
            {paths.length === 0 && (
              <p className="text-sm text-[var(--text-mut)]">{t("drafts.empty")}</p>
            )}
            {paths.map((path) => (
              <details key={path} className="card p-2" open={paths.length === 1}>
                <summary className="cursor-pointer font-mono text-xs">{path}</summary>
                <div className="grid gap-2 pt-2 sm:grid-cols-2">
                  <div>
                    <span className="field-label">{t("drafts.before")}</span>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                      {local?.baseline[path] ?? "—"}
                    </pre>
                  </div>
                  <div>
                    <span className="field-label">{t("drafts.after")}</span>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                      {local?.tree[path] ?? "—"}
                    </pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
