import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import {
  type NexoGlyph,
  fetchNexoGlyph,
  listNexoGlyphs,
  nexoGlyphUrl,
  uploadAsset,
} from "@/lib/api/userAssets";
import { cx } from "@/lib/cx";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetNameFromFile } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";

// Nexo ids may contain dots: give the sanitizer an extension to strip.
const nameOf = (id: string) => assetNameFromFile(`${id}.png`);

// ponytail: grid capped instead of virtualised; search narrows big Nexo setups.
const MAX_SHOWN = 60;

/** Copies Nexo glyph textures into the project as ordinary image assets. Re-importing updates them. */
export function AssetImportNexoDialog({
  projectId,
  open,
  onClose,
}: { projectId: ProjectId; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const assets = useAssetStore((s) => s.assets);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const [glyphs, setGlyphs] = useState<NexoGlyph[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGlyphs(null);
    setError(null);
    setSelected(new Set());
    listNexoGlyphs(projectId)
      .then(setGlyphs)
      .catch(() => setError(t("nexoImport.loadError")));
  }, [open, projectId, t]);

  const existing = new Set(assets.filter((a) => a.projectId === projectId).map((a) => a.name));
  const matches = (glyphs ?? []).filter((g) => g.id.toLowerCase().includes(search.toLowerCase()));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const id of selected) {
        const name = nameOf(id);
        const file = new File([await fetchNexoGlyph(projectId, id)], `${name}.png`, {
          type: "image/png",
        });
        upsertAsset(
          await uploadAsset(projectId, { file, type: "glyph", name, replace: existing.has(name) }),
        );
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("nexoImport.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            aria-label={t("nexoImport.search")}
            placeholder={t("nexoImport.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {glyphs === null && !error ? (
            <output className="block text-sm text-[var(--text-mut)]">
              {t("nexoImport.loading")}
            </output>
          ) : glyphs?.length === 0 ? (
            <output className="block text-sm text-[var(--text-mut)]">
              {t("nexoImport.empty")}
            </output>
          ) : (
            <div className="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 overflow-y-auto">
              {matches.slice(0, MAX_SHOWN).map((glyph) => (
                <NexoGlyphTile
                  key={glyph.id}
                  projectId={projectId}
                  glyph={glyph}
                  selected={selected.has(glyph.id)}
                  imported={existing.has(nameOf(glyph.id))}
                  onToggle={() => toggle(glyph.id)}
                />
              ))}
            </div>
          )}
          {matches.length > MAX_SHOWN && (
            <p className="text-xs text-[var(--text-mut)]">
              {t("nexoImport.more", { count: matches.length - MAX_SHOWN })}
            </p>
          )}
          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("nexoImport.cancel")}
            </Button>
            <Button disabled={busy || selected.size === 0} onClick={onSubmit}>
              {t("nexoImport.submit", { count: selected.size })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NexoGlyphTile({
  projectId,
  glyph,
  selected,
  imported,
  onToggle,
}: {
  projectId: ProjectId;
  glyph: NexoGlyph;
  selected: boolean;
  imported: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const src = useAuthenticatedImageUrl(glyph.available ? nexoGlyphUrl(projectId, glyph.id) : "");
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={!glyph.available}
      title={glyph.available ? glyph.texture : t("nexoImport.unavailable")}
      onClick={onToggle}
      className={cx(
        "flex flex-col items-center gap-1 rounded border p-2 text-[11px] disabled:opacity-40",
        selected
          ? "border-[var(--brand)] bg-[var(--brand-soft)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
    >
      <span className="flex h-12 w-full items-center justify-center">
        {src && (
          <img
            src={src}
            alt=""
            className="max-h-12 max-w-full object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        )}
      </span>
      <span className="w-full truncate font-mono">{glyph.id}</span>
      {imported && <Badge variant="amber">{t("nexoImport.update")}</Badge>}
    </button>
  );
}
