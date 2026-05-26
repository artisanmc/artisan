import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deletePack } from "@/lib/packApi";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import type { PackId } from "@/domain/types";

interface DeletePackDialogProps {
  packId: PackId;
  packName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeletePackDialog({ packId, packName, open, onOpenChange }: DeletePackDialogProps) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const token = useSessionStore((s) => s.accessToken);
  const removePack = useAccountStore((s) => s.removePack);
  const packOrder = useAccountStore((s) => s.account.packOrder);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const canDelete = confirm === packId;

  const handleDelete = async () => {
    if (!canDelete || !token || deleting) return;
    setDeleting(true);
    try {
      await deletePack(token, packId);
      removePack(packId);
      const remaining = packOrder.filter((id) => id !== packId);
      if (remaining.length > 0) {
        navigate({ to: "/workspace/$workspaceId", params: { workspaceId: remaining[0]! } });
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
          <DialogTitle>{t("deletePackDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-300">
            {t("deletePackDialog.warning", { name: packName })}
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-500">
              {t("deletePackDialog.confirmLabel")}{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">
                {packId}
              </code>
            </label>
            <Input
              placeholder={packId}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleDelete(); }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={deleting}>
              {t("deletePackDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? t("deletePackDialog.deleting") : t("deletePackDialog.delete")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
