import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteUserProject, loadUserProject } from "@/lib/api/userProjects";
import { projectDestination } from "@/lib/projectNavigation";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import type { ProjectId } from "@/domain/types";

interface DeleteProjectDialogProps {
  projectId: ProjectId;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteProjectDialog({ projectId, projectName, open, onOpenChange }: DeleteProjectDialogProps) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const user = useAuthStore((s) => s.currentUser);
  const removeProject = useAccountStore((s) => s.removeProject);
  const projectOrder = useAccountStore((s) => s.account.projectOrder);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const canDelete = confirm === projectId;

  const handleDelete = async () => {
    if (!canDelete || !user || deleting) return;
    setDeleting(true);
    try {
      await deleteUserProject(projectId);
      removeProject(projectId);
      const remaining = projectOrder.filter((id) => id !== projectId);
      if (remaining.length > 0) {
        const destination = await loadUserProject(remaining[0]!);
        navigate(projectDestination(destination.networkId, destination.project, destination.serverKeyId));
      } else {
        navigate({ to: "/" });
      }
    } finally {
      setDeleting(false);
      onOpenChange(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) setConfirm("");
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteProjectDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--text-mut)]">
            {t("deleteProjectDialog.warning", { name: projectName })}
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-faint)]">
              {t("deleteProjectDialog.confirmLabel")}{" "}
              <code className="rounded bg-[var(--surface-raised-2)] px-1 py-0.5 font-mono text-[var(--text-mut)]">
                {projectId}
              </code>
            </label>
            <Input
              placeholder={projectId}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleDelete(); }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={deleting}>
              {t("deleteProjectDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? t("deleteProjectDialog.deleting") : t("deleteProjectDialog.delete")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
