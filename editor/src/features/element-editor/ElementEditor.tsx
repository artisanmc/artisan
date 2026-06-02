import type { ElementId, Pack } from "@/domain/types";
import { MenuEditor } from "./menu/MenuEditor";
import { CommandEditor } from "./command/CommandEditor";
import { DialogEditor } from "./dialog/DialogEditor";
import { UnknownElementFallback } from "./UnknownElementFallback";

interface Props {
  pack: Pack;
  elementId: ElementId;
}

export function ElementEditor({ pack, elementId }: Props) {
  const menu = pack.menus.find((m) => m.id === elementId);
  if (menu) return <MenuEditor pack={pack} menu={menu} />;

  const command = pack.commands.find((c) => c.id === elementId);
  if (command) return <CommandEditor pack={pack} command={command} />;

  const dialog = pack.dialogs.find((d) => d.id === elementId);
  if (dialog) return <DialogEditor pack={pack} dialog={dialog} />;

  return <UnknownElementFallback />;
}
