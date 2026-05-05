import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Pack } from "@/domain/types";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { Server } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buildZip } from "./buildZip";
import { transform } from "./transform";
import { validate } from "./validate";

interface Props {
  pack: Pack;
  className?: string;
}

export function ExportButton({ pack, className }: Props) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const handleExport = async () => {
    const exportPack = structuredClone(pack);
    for (const menu of exportPack.menus) rekeyMenuLTexts(exportPack, menu);
    for (const cmd of exportPack.commands) rekeyCommandLTexts(exportPack, cmd);

    const result = validate(exportPack);

    if (!result.valid) {
      setErrors(result.errors);
      setOpen(true);
      return;
    }

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        toast.warning(w);
      }
    }

    try {
      const files = transform(exportPack);
      const blob = await buildZip(files);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pack.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("export.success"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("export.failed"));
    }
  };

  return (
    <>
      <button
        type="button"
        title={t("export.button")}
        onClick={handleExport}
        className={
          className ??
          "relative flex h-9 w-9 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        }
      >
        <Server className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("export.errorTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400 mb-3">{t("export.errorSubtitle")}</p>
          <ul className="space-y-1 text-sm text-red-400">
            {errors.map((err, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: error list is stable within a render
              <li key={i} className="flex gap-2">
                <span className="shrink-0">•</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-zinc-500">{t("export.overwriteWarning")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
