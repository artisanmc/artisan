import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getTextureUrl, useTextureStore } from "./textureStore";

interface MaterialPickerProps {
  /** Trigger element rendered by the consumer (a small icon button typically). */
  trigger: React.ReactNode;
  onPick: (material: string) => void;
}

/**
 * Modal item-palette picker. Used as a visual alternative to typing a
 * material name into a text input — opens, user filters + clicks, picker
 * closes and the parent receives the chosen material via `onPick`.
 */
export function MaterialPicker({ trigger, onPick }: MaterialPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const libraryItems = useTextureStore((s) => s.libraryItems);
  const customItems = useTextureStore((s) => s.libraryCustomData.items);
  const allItems = [...libraryItems, ...customItems];
  const filtered = allItems.filter((item) =>
    item.id.toLowerCase().includes(search.toLowerCase()) ||
    item.label.toLowerCase().includes(search.toLowerCase()),
  );
  const { t } = useTranslation();

  const pick = (name: string) => {
    onPick(name);
    setOpen(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-zinc-800 bg-zinc-950 p-3 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("materialPicker.title")}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 h-4 w-4 text-zinc-500" />
          <Input
            autoFocus
            placeholder={t("library.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="grid min-h-0 grid-cols-6 gap-1.5 overflow-y-auto pb-2 sm:grid-cols-8">
          {filtered.map((item) => (
            <Tile key={item.id} name={item.id} label={item.label} onClick={() => pick(item.id)} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-6 py-4 text-center text-xs text-zinc-500 sm:col-span-8">
              {t("library.noMatch")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ name, label, onClick }: { name: string; label: string; onClick: () => void }) {
  const url = getTextureUrl(name);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cx(
        "group relative flex aspect-square cursor-pointer items-center justify-center",
        "rounded border border-zinc-800 bg-zinc-900 hover:border-emerald-500 hover:bg-emerald-500/5",
      )}
    >
      {url ? (
        <img
          src={url}
          alt={name}
          draggable={false}
          className="h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="text-[8px] text-zinc-400">{label.slice(0, 4)}</span>
      )}
    </button>
  );
}
