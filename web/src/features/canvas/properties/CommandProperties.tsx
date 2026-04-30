import type { Command, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { PropertyField } from "./PropertyField";

interface CommandPropertiesProps {
  packId: PackId;
  command: Command;
}

export function CommandProperties({ packId, command }: CommandPropertiesProps) {
  const setCommandField = useAccountStore((s) => s.setCommandField);

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
