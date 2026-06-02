import type { Dialog, Pack } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { DialogMetaForm } from "./DialogMetaForm";

interface Props {
  pack: Pack;
  dialog: Dialog;
}

export function DialogEditor({ pack, dialog }: Props) {
  const updateDialog = useAccountStore((s) => s.updateDialog);

  return (
    <div className="h-full overflow-auto">
      <DialogMetaForm
        pack={pack}
        dialog={dialog}
        onChange={(next) => updateDialog({ packId: pack.id, dialog: next })}
      />
    </div>
  );
}
