import { Button } from "@/components/ui/button";
import type { Menu, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { type ChangeEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface BackgroundUploadProps {
  packId: PackId;
  menu: Menu;
}

const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB

const readFile = (file: File): Promise<{ dataUrl: string; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("unexpected reader result"));
        return;
      }
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.width, height: img.height });
      img.onerror = () => reject(new Error("could not decode image"));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

export function BackgroundUpload({ packId, menu }: BackgroundUploadProps) {
  const setMenuBackground = useAccountStore((s) => s.setMenuBackground);
  const asset = useAccountStore((s) => {
    if (!menu.background) return undefined;
    const pack = s.account.packs.find((p) => p.id === packId);
    return pack?.assets.find((a) => a.id === menu.background!.assetId);
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(t("backgroundUpload.fileTooLarge", { kb: MAX_FILE_SIZE_BYTES / 1024 }));
      return;
    }
    setBusy(true);
    try {
      const { dataUrl, width, height } = await readFile(file);
      setMenuBackground({
        packId,
        menuId: menu.id,
        asset: { name: file.name, dataUrl, width, height },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("backgroundUpload.uploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-zinc-500">{t("backgroundUpload.label")}</div>
      {asset ? (
        <div className="flex items-center gap-2">
          <img
            src={asset.url}
            alt={asset.name}
            className="h-10 w-10 rounded border border-zinc-800 object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs">{asset.name}</div>
            <div className="text-[10px] text-zinc-500">
              {asset.width}×{asset.height}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            title={t("backgroundUpload.remove")}
            onClick={() => setMenuBackground({ packId, menuId: menu.id, asset: null })}
          >
            ✕
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start text-xs"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? t("backgroundUpload.reading") : t("backgroundUpload.upload")}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}
