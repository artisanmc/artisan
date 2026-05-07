import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useState } from "react";

interface NewDialogDialogProps {
  packId: PackId;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

export function NewDialogDialog({ packId, open, position, onOpenChange }: NewDialogDialogProps) {
  const [id, setId] = useState("");

  const submit = () => {
    if (!id.trim()) return;
    const dialogId = useAccountStore.getState().createDialog({ packId, id: id.trim(), position });
    useSelectionStore.getState().set([dialogId]);
    setId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau dialogue</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="d_confirm_buy"
            value={id}
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button onClick={submit}>Créer</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
