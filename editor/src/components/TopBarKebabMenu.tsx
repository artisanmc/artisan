import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TopBarKebabMenuProps {
  onImport: () => void;
  onExport: () => void;
  onExportZip: () => void;
  onOpenPatterns: () => void;
  onDelete: () => void;
}

export function TopBarKebabMenu({
  onImport,
  onExport,
  onExportZip,
  onOpenPatterns,
  onDelete,
}: TopBarKebabMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("topbar.more")}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
      >
        <MoreVertical className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onExportZip}>{t("topbar.exportZip")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport}>{t("topbar.import")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>{t("topbar.export")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenPatterns}>{t("patterns.title")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-[var(--brick)] focus:text-[var(--brick)]"
        >
          {t("topbar.deletePack")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
