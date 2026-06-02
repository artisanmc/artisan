import type { Command, Pack } from "@/domain/types";
import { useTranslation } from "react-i18next";

interface Props {
  pack: Pack;
  command: Command;
  onChange: (next: Command) => void;
}

export function CommandMetaForm({ pack: _pack, command, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 p-3">
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[var(--ink-mut)]">{t("commandMeta.trigger")}</span>
        <input
          className="input mono"
          value={command.name}
          onChange={(e) => onChange({ ...command, name: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[var(--ink-mut)]">{t("commandMeta.aliases")}</span>
        <input
          className="input mono"
          value={(command.aliases ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              ...command,
              aliases: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[var(--ink-mut)]">{t("commandMeta.permission")}</span>
        <input
          className="input mono"
          value={command.permission ?? ""}
          onChange={(e) =>
            onChange({ ...command, permission: e.target.value || undefined })
          }
        />
      </label>
    </div>
  );
}
