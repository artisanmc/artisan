import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { isKindSyncedOn, useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useTranslation } from "react-i18next";
import { NewPrefixedIdDialog } from "./NewPrefixedIdDialog";

interface NewDocumentDialogProps {
  projectId: ProjectId;
  /** A kind some module contributes (`documentKindContribution(kind)` is defined). */
  kind: string;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

/**
 * Creation of a Document of any contributed kind: an id, prefixed as the kind
 * declares, seeded by the contribution's `create`. Menus and dialogs go through
 * the same `NewPrefixedIdDialog`; commands keep `NewCommandDialog` (name → id).
 */
export function NewDocumentDialog({
  projectId,
  kind,
  open,
  position,
  onOpenChange,
}: NewDocumentDialogProps) {
  const { t } = useTranslation();
  const contribution = documentKindContribution(kind);
  const kindLabel = contribution
    ? t(contribution.label, { defaultValue: contribution.label })
    : kind;
  // The editor's module knows the kind; does the server's? A kind the active server
  // does not register is written to a folder nothing there reads (W6).
  const synced = useServerDocumentKindsStore((s) => isKindSyncedOn(s, kind));

  return (
    <NewPrefixedIdDialog
      projectId={projectId}
      open={open}
      onOpenChange={onOpenChange}
      title={t("canvas.newDocumentDialogTitle", { kind: kindLabel })}
      prefix={contribution?.idPrefix ?? ""}
      canCreate={!!contribution}
      onCreate={(id) =>
        useAccountStore.getState().createDocument({ projectId, kind, id, position })
      }
    >
      {!synced && (
        <output className="text-xs text-[var(--warning)]">
          {t("canvas.kindNotSynced", { kind: kindLabel })}
        </output>
      )}
    </NewPrefixedIdDialog>
  );
}
