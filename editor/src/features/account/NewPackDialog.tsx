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

interface NewPackDialogProps {
  trigger?: ReactElement;
}

export function NewPackDialog({ trigger }: NewPackDialogProps = {}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createPack = useAccountStore((s) => s.createPack);
  const { t } = useTranslation();

  const submit = () => {
    if (!name.trim()) return;
    createPack({ name: name.trim() });
    setName("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline">+ {t("packMini.newPack")}</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newPackDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder={t("newPackDialog.placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("newPackDialog.cancel")}
            </Button>
            <Button onClick={submit}>{t("newPackDialog.create")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
