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

interface NewPackDialogProps {
  trigger?: ReactElement;
}

export function NewPackDialog({ trigger }: NewPackDialogProps = {}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createPack = useAccountStore((s) => s.createPack);

  const submit = () => {
    if (!name.trim()) return;
    createPack({ name: name.trim() });
    setName("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline">+ New pack</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New pack</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Pack name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
