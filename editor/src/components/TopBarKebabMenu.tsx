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
  onOpenPatterns: () => void;
  onDelete: () => void;
}

export function TopBarKebabMenu({
  onImport,
  onExport,
  onOpenPatterns,
  onDelete,
}: TopBarKebabMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("topbar.more")}
        className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <MoreVertical className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-zinc-700 bg-zinc-900 text-zinc-200">
        <DropdownMenuItem onSelect={onImport}>{t("topbar.import")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>{t("topbar.export")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenPatterns}>{t("patterns.title")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-red-400 focus:text-red-300">
          {t("topbar.deletePack")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
