import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type RenameOperation, renameProject } from "@/lib/api/projectIdentity";
import { isValidProjectFolderName } from "@/lib/projectFolderName";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

type RenameableProject = {
  id: string;
  externalId?: string | null;
  capabilities?: { canRename: boolean };
  pendingRename?: RenameOperation;
};
function readPending(key: string): RenameOperation | null {
  try {
    const operation = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return typeof operation?.operationId === "string" && typeof operation?.targetId === "string"
      ? operation
      : null;
  } catch {
    return null;
  }
}

export function RenameProjectButton({
  project,
  onRenamed,
}: { project: RenameableProject; onRenamed: (diskId: string) => void }) {
  const { t } = useTranslation();
  const fieldId = useId();
  const key = `artisan.rename.${project.id}`;
  const [operation, setOperation] = useState<RenameOperation | null>(() =>
    project.pendingRename
      ? { operationId: project.pendingRename.operationId, targetId: project.pendingRename.targetId }
      : readPending(key),
  );
  const [targetId, setTargetId] = useState(operation?.targetId ?? project.externalId ?? project.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!project.capabilities?.canRename && !operation) return null;

  async function submit() {
    const next = operation ?? { operationId: crypto.randomUUID(), targetId: targetId.trim() };
    setOperation(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Retry remains available in this tab. */
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await renameProject(project.id, next);
      if (result.status === "pending") {
        setMessage(
          t("projectIdentity.pending", {
            defaultValue: "Rename pending. Reconnect the server, then retry to confirm the result.",
          }),
        );
        return;
      }
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* The completed result is still applied. */
      }
      setOperation(null);
      setOpen(false);
      onRenamed(result.diskId);
    } catch (error) {
      if (error instanceof Error && "terminal" in error && error.terminal === true) {
        setOperation(null);
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* A new operation replaces it on the next attempt. */
        }
        const errors: Record<string, string> = {
          destination_exists: "occupied",
          destination_reserved: "reserved",
          invalid_path: "invalidTarget",
          invalid_input: "invalidTarget",
          addon_immutable: "immutable",
          unknown_project: "missing",
          server_offline: "serverOffline",
          plugin_update_required: "updateRequired",
        };
        setMessage(t(`projectIdentity.${errors[error.message] ?? "rejected"}`));
      } else {
        setMessage(
          t("projectIdentity.retryError", {
            defaultValue: "The rename could not be confirmed. Retry to recover its result.",
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("projectIdentity.edit", { defaultValue: "Edit" })}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {t("projectIdentity.renameTitle", { defaultValue: "Change project ID" })}
          </DialogTitle>
          <DialogDescription>
            {t("projectIdentity.renameDescription", {
              defaultValue:
                "Change the project ID (its folder on the server) while keeping its drafts and links.",
            })}
          </DialogDescription>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label htmlFor={fieldId} className="field-label flex flex-col gap-2">
              {t("projectIdentity.folder", { defaultValue: "Project folder" })}
              <Input
                id={fieldId}
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                disabled={busy || operation !== null}
                required
              />
            </label>
            {message && <output className="text-sm text-[var(--text-mut)]">{message}</output>}
            <p className="text-sm text-[var(--text-mut)]">
              {t("projectIdentity.folderHint", {
                defaultValue:
                  "Use letters, numbers, underscores or hyphens (up to 128 characters).",
              })}
            </p>
            <Button
              type="submit"
              disabled={
                busy ||
                !isValidProjectFolderName(targetId.trim()) ||
                (!operation && targetId.trim() === (project.externalId ?? project.id))
              }
            >
              {operation
                ? t("projectIdentity.retry", { defaultValue: "Retry" })
                : t("projectIdentity.rename", { defaultValue: "Save" })}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
