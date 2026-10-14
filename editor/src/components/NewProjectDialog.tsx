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
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

interface NewProjectDialogProps {
  /** Server key to associate the new project with. */
  serverKeyId?: string | null;
  /** Called with the new workspace id after a successful create. */
  onCreated?: (id: string) => void;
  trigger?: ReactElement;
}

/** Creates the project on the server's disk through the hub. */
export function NewProjectDialog({ serverKeyId, onCreated, trigger }: NewProjectDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!serverKeyId || submitting) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject(serverKeyId, trimmed);
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
    <Button variant="outline" disabled={!serverKeyId}>
      + {t("projectMini.newProject")}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newProjectDialog.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            placeholder={t("newProjectDialog.placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <div role="alert" className="text-xs text-[var(--danger)]">
              {t(`newProjectDialog.errors.${error}`, {
                defaultValue: t("newProjectDialog.errors.create_failed"),
              })}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("newProjectDialog.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || !serverKeyId || submitting}
            >
              {submitting ? "…" : t("newProjectDialog.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
