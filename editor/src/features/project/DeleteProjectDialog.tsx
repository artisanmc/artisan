import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import { deleteUserProject, loadUserProject } from "@/lib/api/userProjects";
import { projectDestination } from "@/lib/projectNavigation";
import { useAuthStore } from "@/state/authStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

interface DeleteProjectDialogProps {
  projectId: ProjectId;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteProjectDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: DeleteProjectDialogProps) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmInputId = useId();
  const user = useAuthStore((s) => s.currentUser);
  const removeProject = useProjectsStore((s) => s.removeProject);
  const projectOrder = useProjectsStore((s) => s.openProjects.projectOrder);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const canDelete = confirm === projectId;

  const handleDelete = async () => {
    if (!canDelete || !user || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteUserProject(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
      setDeleting(false);
      return;
    }
    removeProject(projectId);
    const remaining = projectOrder.filter((id) => id !== projectId);
    try {
      if (remaining.length === 0) throw new Error("no_project_left");
      const destination = await loadUserProject(remaining[0]!);
      navigate(projectDestination(destination.project, destination.serverKeyId));
    } catch {
      navigate({ to: "/" });
    } finally {
      setDeleting(false);
      onOpenChange(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setConfirm("");
      setError(null);
    }
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
            <label htmlFor={confirmInputId} className="text-xs text-[var(--text-faint)]">
              {t("deleteProjectDialog.confirmLabel")}{" "}
              <code className="rounded bg-[var(--surface-raised-2)] px-1 py-0.5 font-mono text-[var(--text-mut)]">
                {projectId}
              </code>
            </label>
            <Input
              id={confirmInputId}
              placeholder={projectId}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDelete();
              }}
              autoFocus
            />
          </div>
          {error && (
            <div role="alert" className="text-xs text-[var(--danger)]">
              {t(`deleteProjectDialog.errors.${error}`, {
                defaultValue: t("deleteProjectDialog.errors.delete_failed"),
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={deleting}>
              {t("deleteProjectDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!canDelete || deleting}>
              {deleting ? t("deleteProjectDialog.deleting") : t("deleteProjectDialog.delete")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
