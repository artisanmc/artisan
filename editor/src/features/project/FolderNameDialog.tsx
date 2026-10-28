import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { folderName, slugifyFolderName } from "@/domain/folders";
import type { ProjectId } from "@/domain/types";
import { FolderOperationError } from "@/state/projects/foldersSlice";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Creates a folder in `parent`, or renames `renaming`. */
export function FolderNameDialog({
  projectId,
  parent,
  renaming,
  open,
  onOpenChange,
}: {
  projectId: ProjectId;
  parent: string;
  renaming?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(renaming ? folderName(renaming) : "");
    setError(null);
  }, [open, renaming]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name) return;
    const store = useProjectsStore.getState();
    try {
      if (renaming) store.renameFolder({ projectId, path: renaming, name });
      else store.createFolder({ projectId, parent, name });
      onOpenChange(false);
    } catch (e) {
      if (e instanceof FolderOperationError) setError(t(`folders.errors.${e.code}`));
      else throw e;
    }
  };
  const title = renaming
    ? t("folders.rename")
    : parent
      ? t("folders.newSubfolder")
      : t("folders.newFolder");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{parent ? `${parent}/` : t("folders.root")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="field-label" htmlFor="folder-name">
            {t("folders.name")}
          </label>
          <Input
            id="folder-name"
            autoFocus
            value={name}
            maxLength={64}
            aria-invalid={error !== null}
            onChange={(e) => {
              setName(slugifyFolderName(e.target.value));
              setError(null);
            }}
          />
          <p
            className={`text-[12px] ${error ? "text-[var(--danger)]" : "text-[var(--text-faint)]"}`}
          >
            {error ?? t("folders.nameHint")}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("folders.cancel")}
            </Button>
            <Button type="submit" disabled={!name}>
              {renaming ? t("folders.save") : t("folders.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
