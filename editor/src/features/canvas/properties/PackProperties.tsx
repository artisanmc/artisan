import type { Pack } from "@/domain/types";
import { DeletePackDialog } from "@/features/account/DeletePackDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { useAccountStore } from "@/state/accountStore";
import { LayoutGrid, Plus, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";
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
    ? "bg-[var(--terra-soft)] text-[var(--terra)]"
    : source === "forked"
      ? "bg-[var(--gold-soft)] text-[var(--gold)]"
      : "bg-[var(--sage-soft)] text-[var(--terra)]";

export function PackProperties({ pack }: PackPropertiesProps) {
  const setPackField = useAccountStore((s) => s.setPackField);
  const { t } = useTranslation();
  const [menuDialogOpen, setMenuDialogOpen] = useState(false);
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase text-[var(--ink-faint)]">{t("packProperties.id")}</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--ink-mut)]">{pack.id}</span>
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
        onCreate={() => setMenuDialogOpen(true)}
        createLabel={t("packProperties.newMenu")}
      />
      <NewMenuDialog packId={pack.id} open={menuDialogOpen} onOpenChange={setMenuDialogOpen} />
      <ContentsSection
        icon={<Terminal className="h-3.5 w-3.5" />}
        label={t("packProperties.commandsLabel")}
        count={pack.commands.length}
        emptyHint={t("packProperties.commandsEmpty")}
        onCreate={() => setCommandDialogOpen(true)}
        createLabel={t("packProperties.newCommand")}
      />
      <NewCommandDialog
        packId={pack.id}
        open={commandDialogOpen}
        onOpenChange={setCommandDialogOpen}
      />

      <div className="text-[10px] text-[var(--ink-faint)]">
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

      <div className="mt-2 border-t border-[var(--line-soft)] pt-4">
        <button
          type="button"
          onClick={() => setDeleteDialogOpen(true)}
          className="inline-flex items-center gap-1.5 rounded border border-red-900/50 px-2.5 py-1.5 text-[11px] text-[var(--brick)] hover:border-red-700/60 hover:bg-red-900/20"
        >
          <Trash2 className="h-3 w-3" />
          {t("packProperties.deletePack")}
        </button>
      </div>

      <DeletePackDialog
        packId={pack.id}
        packName={pack.name}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
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
          ? "flex flex-col gap-2 rounded border border-[var(--line-soft)] border-dashed bg-[var(--card-surface)]/40 p-3"
          : "flex items-center gap-2"
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--ink-faint)] uppercase tracking-wide">
        {icon}
        <span>
          {count} {label}
        </span>
      </div>
      {isEmpty ? <p className="text-[11px] text-[var(--ink-mut)]">{emptyHint}</p> : null}
      <button
        type="button"
        onClick={onCreate}
        className={
          isEmpty
            ? "self-start inline-flex items-center gap-1 rounded border border-[var(--terra)]/60 bg-[var(--terra-soft)] px-2.5 py-1.5 text-[11px] text-[var(--terra)] hover:bg-[var(--terra)]/20"
            : "ml-auto inline-flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:bg-[var(--raised-2)]"
        }
      >
        <Plus className="h-3 w-3" />
        {createLabel}
      </button>
    </div>
  );
}
