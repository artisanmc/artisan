import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createProject } from "@/lib/api/networks";

interface NewProjectDialogProps {
  /** Network the new workspace will be created in. When null, the trigger is disabled. */
  networkId: string | null;
  /** Server key to associate the new project with (forwarded to the backend). */
  serverKeyId?: string | null;
  /** Called with the new workspace id after a successful create. */
  onCreated?: (id: string) => void;
  trigger?: ReactElement;
}

/**
 * Creates a workspace on the backend (`POST /api/v1/networks/:id/projects`), not just
 * in local state. Unlike the legacy NewProjectDialog, the new workspace persists
 * across reloads and is bound to a real network.
 */
export function NewProjectDialog({ networkId, serverKeyId, onCreated, trigger }: NewProjectDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!networkId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject(networkId, serverKeyId ?? "", trimmed);
      setName("");
      setOpen(false);
      onCreated?.(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const defaultTrigger = (
    <Button variant="outline" disabled={!networkId}>
      + {t("projectMini.newProject")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newProjectDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="my_project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            autoFocus
          />
          {error && (
            <div className="text-xs text-[var(--danger)]">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              {t("newProjectDialog.cancel")}
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim() || !networkId || submitting}>
              {submitting ? "…" : t("newProjectDialog.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
