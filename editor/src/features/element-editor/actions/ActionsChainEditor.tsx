import { useTranslation } from "react-i18next";
import type { Menu, Step } from "@/domain/types";
import { ActionBlock } from "./ActionBlock";
import { IfBlock } from "./IfBlock";

interface Props {
  steps: Step[];
  packMenus: Menu[];
  onChange: (next: Step[]) => void;
}

export function ActionsChainEditor({ steps, packMenus, onChange }: Props) {
  const { t } = useTranslation();

  if (steps.length === 0) {
    return (
      <p className="text-[12px] text-[var(--text-faint)]">{t("actions.empty")}</p>
    );
  }

  const updateAt = (i: number, next: Step) => {
    const list = steps.slice();
    list[i] = next;
    onChange(list);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((s, i) => {
        if (s.kind === "action") {
          return (
            <ActionBlock
              key={i}
              action={s.action}
              packMenus={packMenus}
              onChange={(nextAction) =>
                updateAt(i, { kind: "action", action: nextAction })
              }
            />
          );
        }
        if (s.kind === "if") {
          return (
            <IfBlock
              key={i}
              step={s}
              packMenus={packMenus}
              onChange={(nextStep) => updateAt(i, nextStep)}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
