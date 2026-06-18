import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAccountStore } from "@/state/accountStore";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

interface NewProjectDialogProps {
  trigger?: ReactElement;
}

export function NewProjectDialog({ trigger }: NewProjectDialogProps = {}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const createProject = useAccountStore((s) => s.createProject);
  const { t } = useTranslation();

  const submit = () => {
    if (!id.trim()) return;
    createProject({ id: id.trim() });
    setId("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline">+ {t("projectMini.newProject")}</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newProjectDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="my_project"
            value={id}
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("newProjectDialog.cancel")}
            </Button>
            <Button onClick={submit}>{t("newProjectDialog.create")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
