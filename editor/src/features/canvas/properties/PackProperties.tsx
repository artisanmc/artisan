import type { Pack } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { LayoutGrid, Plus, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PropertyField } from "./PropertyField";

interface PackPropertiesProps {
  pack: Pack;
}

const sourceLabelKey = (
  source: Pack["source"],
): "sourceImported" | "sourceForked" | "sourceUser" =>
  source === "imported" ? "sourceImported" : source === "forked" ? "sourceForked" : "sourceUser";

const sourceColor = (source: Pack["source"]) =>
  source === "imported"
    ? "bg-blue-500/15 text-blue-300"
    : source === "forked"
      ? "bg-amber-500/15 text-amber-300"
      : "bg-emerald-500/15 text-emerald-300";

export function PackProperties({ pack }: PackPropertiesProps) {
  const setPackField = useAccountStore((s) => s.setPackField);
  const createMenu = useAccountStore((s) => s.createMenu);
  const createCommand = useAccountStore((s) => s.createCommand);
  const setSelection = useSelectionStore((s) => s.set);
  const { t } = useTranslation();

  const onCreateMenu = () => {
    const id = createMenu({ packId: pack.id });
    setSelection([id]);
  };
  const onCreateCommand = () => {
    const id = createCommand({ packId: pack.id });
    setSelection([id]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase text-zinc-500">{t("packProperties.id")}</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-400">{pack.id}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${sourceColor(pack.source)}`}>
              {t(`packProperties.${sourceLabelKey(pack.source)}`)}
            </span>
          </div>
        </div>
        <PropertyField
          label={t("packProperties.name")}
          value={pack.name}
          onChange={(v) => setPackField({ packId: pack.id, field: "name", value: v })}
        />
        <PropertyField
          label={t("packProperties.description")}
          value={pack.description ?? ""}
          placeholder={t("packProperties.descriptionPlaceholder")}
          multiline
          onChange={(v) => setPackField({ packId: pack.id, field: "description", value: v })}
        />
      </div>

      <ContentsSection
        icon={<LayoutGrid className="h-3.5 w-3.5" />}
        label={t("packProperties.menusLabel")}
        count={pack.menus.length}
        emptyHint={t("packProperties.menusEmpty")}
        onCreate={onCreateMenu}
        createLabel={t("packProperties.newMenu")}
      />
      <ContentsSection
        icon={<Terminal className="h-3.5 w-3.5" />}
        label={t("packProperties.commandsLabel")}
        count={pack.commands.length}
        emptyHint={t("packProperties.commandsEmpty")}
        onCreate={onCreateCommand}
        createLabel={t("packProperties.newCommand")}
      />

      <div className="text-[10px] text-zinc-500">
        {t("packProperties.countTemplatesAssets", {
          templates: pack.templates.length,
          templatesPlural: t(
            pack.templates.length === 1
              ? "packProperties.templateOne"
              : "packProperties.templateOther",
          ),
          assets: pack.assets.length,
          assetsPlural: t(
            pack.assets.length === 1 ? "packProperties.assetOne" : "packProperties.assetOther",
          ),
        })}
      </div>
    </div>
  );
}

function ContentsSection({
  icon,
  label,
  count,
  emptyHint,
  onCreate,
  createLabel,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  emptyHint: string;
  onCreate: () => void;
  createLabel: string;
}) {
  const isEmpty = count === 0;
  return (
    <div
      className={
        isEmpty
          ? "flex flex-col gap-2 rounded border border-zinc-800 border-dashed bg-zinc-900/40 p-3"
          : "flex items-center gap-2"
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-wide">
        {icon}
        <span>
          {count} {label}
        </span>
      </div>
      {isEmpty ? <p className="text-[11px] text-zinc-400">{emptyHint}</p> : null}
      <button
        type="button"
        onClick={onCreate}
        className={
          isEmpty
            ? "self-start inline-flex items-center gap-1 rounded border border-emerald-600/60 bg-emerald-600/10 px-2.5 py-1.5 text-[11px] text-emerald-200 hover:bg-emerald-600/20"
            : "ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
        }
      >
        <Plus className="h-3 w-3" />
        {createLabel}
      </button>
    </div>
  );
}
