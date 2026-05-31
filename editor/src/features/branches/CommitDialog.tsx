import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createCommit } from "@/lib/api/branches";

interface Props {
  networkId: string;
  packId: string;
  branch: string;
  open: boolean;
  onClose: () => void;
}

export function CommitDialog({ networkId, packId, branch, open, onClose }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createCommit(networkId, packId, branch, message.trim());
      setMessage("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Commit on {branch}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {error && <div className="text-xs text-[var(--brick)]">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={onSubmit} disabled={busy || !message.trim()}>Commit</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
