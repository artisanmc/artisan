import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hasDraftChanges } from "@/features/project/draft";
import { flushDraftEdits } from "@/features/project/draftFlush";
import { type ProjectCopyTarget, listProjectCopyTargets } from "@/lib/api/projectCopies";
import { copyRecoveryGeneration } from "@/lib/copyRecovery";
import { isValidProjectFolderName } from "@/lib/projectFolderName";
import { projectDestination } from "@/lib/projectNavigation";
import { projectPrincipal } from "@/lib/projectPrincipal";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type PendingProjectCopy,
  copyProjectToServer,
  forgetProjectCopy,
  getPendingProjectCopy,
  resumeProjectCopy,
} from "./copyProjectToServer";

export function CopyProjectToServerButton({ projectId }: { projectId: string }) {
  const runtime = useProjectRuntime(projectId);
  const ownerId = useAuthStore((state) => state.currentUser?.id);
  if (!ownerId || !runtime?.capabilities.canCopyToServer) return null;
  return (
    <CopyProjectDialog key={`${ownerId}:${projectId}`} ownerId={ownerId} projectId={projectId} />
  );
}
function CopyProjectDialog({ ownerId, projectId }: { ownerId: string; projectId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<ProjectCopyTarget[]>([]);
  const [sourceRevision, setSourceRevision] = useState("");
  const [targetId, setTargetId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [choice, setChoice] = useState<"saved" | "apply">("saved");
  const [pending, setPending] = useState(() => getPendingProjectCopy(ownerId, projectId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestActive = useRef(false);
  const draft = useProjectDraftStore((state) => state.drafts[projectId]);
  const dirty = draft ? hasDraftChanges(draft) : false;
  const generation = useRef(copyRecoveryGeneration()).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    projectPrincipal.current()?.id === ownerId &&
    generation === copyRecoveryGeneration();
  useEffect(() => {
    if (!open || pending) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void listProjectCopyTargets(projectId)
      .then((catalog) => {
        if (cancelled) return;
        setTargets(catalog.targets);
        setSourceRevision(catalog.sourceRevision);
        const first = catalog.targets.find((target) => target.compatible);
        setTargetId(first?.serverKeyId ?? "");
        setFolderName(first?.folderName ?? "");
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "copy_failed");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, pending]);
  function openCopy(result: PendingProjectCopy) {
    if (!current() || !result.operation.projectId) return;
    void navigate(
      projectDestination(
        result.operation.targetNetworkId ?? result.target.networkId,
        { id: result.operation.projectId, externalId: result.operation.folderName },
        result.operation.targetServerKeyId,
      ),
    );
  }
  async function run() {
    if (requestActive.current) return;
    requestActive.current = true;
    setBusy(true);
    setError(null);
    try {
      flushDraftEdits();
      const target = targets.find((entry) => entry.serverKeyId === targetId);
      if (!pending && !target) throw new Error("server_offline");
      const result = pending
        ? await resumeProjectCopy(ownerId, projectId)
        : await copyProjectToServer({
            ownerId,
            projectId,
            target: target!,
            folderName: folderName.trim(),
            sourceRevision,
            choice,
          });
      if (!current()) return;
      setPending(result);
      if (result.operation.state === "completed" && !result.operation.error) openCopy(result);
      if (result.operation.error && result.operation.error !== "resource_pack_pending") setError(result.operation.error);
    } catch (failure) {
      if (!current()) return;
      setPending(getPendingProjectCopy(ownerId, projectId));
      setError(failure instanceof Error ? failure.message : "copy_failed");
    } finally {
      requestActive.current = false;
      if (current()) setBusy(false);
    }
  }
  const target = targets.find((entry) => entry.serverKeyId === targetId);
  const resourcePackPending =
    pending?.operation.state === "completed" && pending.operation.error === "resource_pack_pending";
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          flushDraftEdits();
          setOpen(true);
        }}
      >
        <Copy className="size-4" />
        {t("projectCopy.title")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>{t("projectCopy.title")}</DialogTitle>
          <DialogDescription>{t("projectCopy.description")}</DialogDescription>
          {pending ? (
            <div className="flex flex-col gap-4">
              <p>
                {t("projectCopy.destination", {
                  server: pending.target.name,
                  folder: pending.request.folderName,
                })}
              </p>
              <output>
                {t(
                  resourcePackPending
                    ? "projectCopy.resourcePackPending"
                    : `projectCopy.${pending.operation.state}`,
                )}
              </output>
              {resourcePackPending && (
                <Button disabled={busy} onClick={() => void run()}>
                  {t(busy ? "projectCopy.resourcePackWorking" : "projectCopy.retryResourcePack")}
                </Button>
              )}
              {pending.operation.state === "completed" ? (
                <Button onClick={() => openCopy(pending)}>{t("projectCopy.open")}</Button>
              ) : pending.operation.state === "pending" ? (
                <Button disabled={busy} onClick={() => void run()}>
                  {t("projectCopy.resume")}
                </Button>
              ) : null}
              {pending.operation.state !== "pending" && !resourcePackPending && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    forgetProjectCopy(ownerId, projectId);
                    setPending(null);
                    setError(null);
                  }}
                >
                  {t("projectCopy.another")}
                </Button>
              )}
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run();
              }}
            >
              <label htmlFor={`${fieldId}-server`} className="field-label flex flex-col gap-2">
                {t("projectCopy.server")}
                <select
                  id={`${fieldId}-server`}
                  className="input"
                  value={targetId}
                  disabled={busy}
                  onChange={(event) => {
                    setTargetId(event.target.value);
                    setFolderName(
                      targets.find((entry) => entry.serverKeyId === event.target.value)
                        ?.folderName ?? "",
                    );
                  }}
                >
                  <option value="">{t("projectCopy.chooseServer")}</option>
                  {targets.map((entry) => (
                    <option
                      key={entry.serverKeyId}
                      value={entry.serverKeyId}
                      disabled={!entry.compatible}
                    >
                      {entry.name}
                      {entry.compatible
                        ? ""
                        : ` — ${t(`projectCopy.errors.${entry.reason}`, { defaultValue: t("projectCopy.incompatible") })}`}
                    </option>
                  ))}
                </select>
              </label>
              {!busy && !targets.some((entry) => entry.compatible) && (
                <output className="text-sm text-[var(--text-mut)]">
                  {t("projectCopy.noTargets")}
                </output>
              )}
              <label htmlFor={`${fieldId}-folder`} className="field-label flex flex-col gap-2">
                {t("projectIdentity.folder")}
                <Input
                  id={`${fieldId}-folder`}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  disabled={busy}
                  required
                />
              </label>
              {dirty && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="field-label mb-2">{t("projectCopy.dirty")}</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`${fieldId}-choice`}
                      checked={choice === "saved"}
                      disabled={busy}
                      onChange={() => setChoice("saved")}
                    />
                    {t("projectCopy.savedChoice")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`${fieldId}-choice`}
                      checked={choice === "apply"}
                      disabled={busy}
                      onChange={() => setChoice("apply")}
                    />
                    {t("projectCopy.applyChoice")}
                  </label>
                </fieldset>
              )}
              <Button
                type="submit"
                disabled={
                  busy ||
                  !target?.compatible ||
                  !sourceRevision ||
                  !isValidProjectFolderName(folderName.trim())
                }
              >
                {busy
                  ? t("projectCopy.working")
                  : t(choice === "apply" ? "projectCopy.apply" : "projectCopy.saved")}
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {t(`projectCopy.errors.${error}`, {
                defaultValue: t("projectCopy.errors.copy_failed"),
              })}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
