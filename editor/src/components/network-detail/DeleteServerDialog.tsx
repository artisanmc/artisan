// P4 will implement this dialog
interface DeleteServerDialogProps {
  server: { id: string; label: string; workspaceCount: number };
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteServerDialog(_: DeleteServerDialogProps) {
  return null;
}
