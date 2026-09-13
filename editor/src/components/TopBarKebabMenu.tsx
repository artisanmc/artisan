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
  onRefresh?: () => void;
  onOpenProjectSettings: () => void;
  onImport?: () => void;
  onExportZip: () => void;
  onOpenPatterns: () => void;
  onDelete?: () => void;
}

export function TopBarKebabMenu({
  onRefresh,
  onOpenProjectSettings,
  onImport,
  onExportZip,
  onOpenPatterns,
  onDelete,
}: TopBarKebabMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("topbar.more")}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        <MoreVertical className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onOpenProjectSettings}>
          {t("projectProperties.title")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {onRefresh && (
          <DropdownMenuItem onSelect={onRefresh}>{t("topbar.refresh")}</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onExportZip}>{t("topbar.exportZip")}</DropdownMenuItem>
        {onImport && <DropdownMenuItem onSelect={onImport}>{t("topbar.import")}</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onOpenPatterns}>{t("patterns.title")}</DropdownMenuItem>
        {onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-[var(--danger)] focus:text-[var(--danger)]"
          >
            {t("topbar.deleteProject")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
