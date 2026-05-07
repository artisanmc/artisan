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

interface NewCommandDialogProps {
  packId: PackId;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function deriveUniqueId(name: string, existingIds: Set<string>): string {
  const base = slugify(name) || "cmd";
  if (!existingIds.has(base)) return base;
  let n = 1;
  while (existingIds.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export function NewCommandDialog({ packId, open, position, onOpenChange }: NewCommandDialogProps) {
  const [name, setName] = useState("");

  const existingIdsStr = useAccountStore((s) => {
    const pack = s.account.packs.find((p) => p.id === packId);
    return (pack?.commands.map((c) => c.id) ?? []).join(",");
  });
  const existingIds = new Set(existingIdsStr ? existingIdsStr.split(",") : []);

  const derivedId = name.trim() ? deriveUniqueId(name, existingIds) : "";

  const submit = () => {
    if (!name.trim()) return;
    const id = useAccountStore.getState().createCommand({
      packId,
      id: derivedId,
      name: name.trim(),
      position,
    });
    useSelectionStore.getState().set([id]);
    setName("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle commande</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Input
              placeholder="shop"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              autoFocus
            />
            {derivedId && (
              <span className="font-mono text-xs text-zinc-400">
                id : <span className="text-zinc-300">{derivedId}</span>
              </span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button onClick={submit} disabled={!name.trim()}>Créer</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
