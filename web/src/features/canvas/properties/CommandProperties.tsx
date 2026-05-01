import type { Action, Command, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { ActionEditor } from "./ActionEditor";
import { PropertyField } from "./PropertyField";

interface CommandPropertiesProps {
  packId: PackId;
  command: Command;
}

export function CommandProperties({ packId, command }: CommandPropertiesProps) {
  const setCommandField = useAccountStore((s) => s.setCommandField);
  const setCommandAction = useAccountStore((s) => s.setCommandAction);
  const sub = useFlowSelectionStore((s) => s.sub);

  // When the user has clicked an action card in the flow canvas, edit
  // that action's parameters; otherwise show the command's identity fields.
  if (sub?.kind === "commandAction") {
    const action = command.actions[sub.actionIndex];
    if (!action) {
      return (
        <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/50 px-2 py-3 text-[11px] text-zinc-500">
          Action no longer exists. Pick another in the flow canvas.
        </div>
      );
    }
    const onChange = (next: Action) =>
      setCommandAction({
        packId,
        commandId: command.id,
        actionIndex: sub.actionIndex,
        action: next,
      });
    return (
      <div className="flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono uppercase tracking-wide text-zinc-300">
            {action.type}
          </span>
          <span>
            action {sub.actionIndex + 1} of {command.actions.length}
          </span>
        </div>
        <ActionEditor packId={packId} action={action} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">id</div>
        <div className="font-mono text-xs text-zinc-400">{command.id}</div>
      </div>
      <PropertyField
        label="name"
        value={command.name}
        onChange={(v) =>
          setCommandField({ packId, commandId: command.id, field: "name", value: v })
        }
      />
      <PropertyField
        label="permission"
        value={command.permission ?? ""}
        placeholder="(none)"
        onChange={(v) =>
          setCommandField({ packId, commandId: command.id, field: "permission", value: v })
        }
      />
      <PropertyField
        label="description"
        value={command.description ?? ""}
        placeholder="(none)"
        multiline
        onChange={(v) =>
          setCommandField({ packId, commandId: command.id, field: "description", value: v })
        }
      />
    </div>
  );
}
