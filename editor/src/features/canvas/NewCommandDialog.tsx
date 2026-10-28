import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { docKey } from "@/domain/documents";
import type { ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUniqueDocumentId } from "./newDocumentId";

interface NewCommandDialogProps {
  projectId: ProjectId;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function NewCommandDialog({
  projectId,
  open,
  position,
  onOpenChange,
}: NewCommandDialogProps) {
  const [name, setName] = useState("");
  const { t } = useTranslation();

  // Free across every kind of the project, module kinds included.
  const derivedId = useUniqueDocumentId(
    projectId,
    name.trim() ? `cmd_${slugify(name) || "cmd"}` : "",
  );

  const submit = () => {
    if (!name.trim()) return;
    const id = useProjectsStore.getState().createCommand({
      projectId,
      id: derivedId,
      name: name.trim(),
      position,
    });
    useSelectionStore.getState().set([docKey("command", id)]);
    setName("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("canvas.newCommandDialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Input
              placeholder="shop"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
            />
            {derivedId && (
              <span className="font-mono text-xs text-[var(--text-mut)]">
                {t("canvas.idPreviewLabel")}{" "}
                <span className="text-[var(--text-mut)]">{derivedId}</span>
              </span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("canvas.cancel")}
            </Button>
            <Button onClick={submit} disabled={!name.trim()}>
              {t("canvas.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
