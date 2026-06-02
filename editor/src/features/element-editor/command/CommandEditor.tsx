import type { Command, Pack, Step } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useTranslation } from "react-i18next";
import { CommandMetaForm } from "./CommandMetaForm";
import { ActionsChainEditor } from "../actions/ActionsChainEditor";
import { AddActionButton } from "../actions/AddActionButton";

interface Props {
  pack: Pack;
  command: Command;
}

export function CommandEditor({ pack, command }: Props) {
  const { t } = useTranslation();
  const updateCommand = useAccountStore((s) => s.updateCommand);
  const isDesktop = useIsDesktop();

  const onMetaChange = (next: Command) =>
    updateCommand({ packId: pack.id, command: next });

  const onChainChange = (steps: Step[]) =>
    updateCommand({ packId: pack.id, command: { ...command, steps } });

  const Meta = (
    <CommandMetaForm pack={pack} command={command} onChange={onMetaChange} />
  );

  const Chain = (
    <div className="flex flex-col gap-2 p-3">
      <h3 className="eyebrow">{t("commandEditor.actionsTitle")}</h3>
      <ActionsChainEditor
        steps={command.steps}
        packMenus={pack.menus}
        onChange={onChainChange}
      />
      <AddActionButton
        onAdd={(step) => onChainChange([...command.steps, step])}
      />
    </div>
  );

  if (isDesktop) {
    return (
      <div className="grid h-full grid-cols-[42%_minmax(0,1fr)] divide-x divide-[var(--line-soft)]">
        <div className="min-h-0 overflow-auto">{Meta}</div>
        <div className="min-h-0 overflow-auto">{Chain}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col divide-y divide-[var(--line-soft)] overflow-auto">
      {Meta}
      {Chain}
    </div>
  );
}
