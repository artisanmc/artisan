import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Asset, AssetUsage } from "@/domain/asset";
import { useImageUses } from "@/features/project/imageUses";
import { createProject } from "@/lib/api/servers";
import { useKitStore } from "@/state/kitStore";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetBytes } from "./assetBytes";
import { useResourcesView } from "./resourcesView";
import { newThemeProblem, saveAsEffect, saveAsNameProblem, saveAsPlaces } from "./saveAsPlaces";

/** What `SaveAsDialog` needs of the server the image's Project is on. */
export interface SaveAsServer {
  serverKeyId: string;
  /** Opens the Resources of the Project `projectId`. */
  open: (projectId: string) => void;
  /** Reads the server's themes again, once one is created. */
  reread: () => void;
}

const NEW = "\u0000new";
const USAGES: readonly string[] = ["button", "menu"];

/**
 * Saves the image open in the atelier under a name in a place (ADR `resources-one-screen`,
 * decision 7): a theme of the server, its own theme, a module, or a theme created on the way.
 * Nothing else is asked: the dialog says what the copy changes, since a name's image is the
 * first found from the menu's module down the themes. The copy is the image as saved, flat;
 * the Resources of the place write it (`useSaveAsAsked`).
 */
export function SaveAsDialog({
  projectId,
  asset,
  server,
  onClose,
}: {
  projectId: string;
  asset: Asset;
  server: SaveAsServer;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const read = useKitStore((s) => s.read);
  const own = useKitStore((s) => s.own);
  const modules = useKitStore((s) => s.modules);
  const themes = useKitStore((s) => s.themes);
  const places = useMemo(
    () => saveAsPlaces({ read, own, modules, themes }),
    [read, own, modules, themes],
  );
  const uses = useImageUses();
  const [name, setName] = useState(asset.name);
  const [chosen, setChosen] = useState(
    () => places.find((p) => p.projectId !== projectId)?.projectId ?? NEW,
  );
  const [themeName, setThemeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const place = places.find((p) => p.projectId === chosen) ?? null;
  const fresh = !place;
  const trimmed = name.trim();
  const theme = themeName.trim();
  const nameProblem = trimmed ? saveAsNameProblem(trimmed, place?.kind ?? "new") : null;
  const themeProblem =
    fresh && theme
      ? newThemeProblem(theme, [...Object.keys(own), ...modules.map((m) => m.folder)])
      : null;
  // The same name in the same place is the image itself.
  const same = place?.projectId === projectId && trimmed === asset.name;
  const effect = saveAsEffect(trimmed, place, uses);
  const ready = !!trimmed && !nameProblem && !same && (!fresh || (!!theme && !themeProblem));
  const label = (p: (typeof places)[number]) =>
    p.kind === "server"
      ? t("places.server")
      : p.kind === "theme"
        ? t(p.inPlace ? "saveAs.theme" : "saveAs.themeAway", { name: p.name })
        : t("saveAs.module", { name: p.name });

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const png = await assetBytes(asset);
      let target = place?.projectId;
      if (!target) {
        target = (await createProject(server.serverKeyId, theme, "theme")).id;
        server.reread();
      }
      useResourcesView.getState().askSaveAs({
        png,
        type: asset.type === "glyph" ? "glyph" : "texture",
        name: trimmed,
        ...(asset.type === "glyph" && asset.ascent !== null ? { ascent: asset.ascent } : {}),
        usages: (asset.usages ?? []).filter((u): u is AssetUsage => USAGES.includes(u)),
        target,
        from: projectId,
      });
      onClose();
      if (target !== projectId) server.open(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("saveAs.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          data-testid="save-as"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1" htmlFor={`${id}-name`}>
            <span className="field-label">{t("saveAs.name")}</span>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" htmlFor={`${id}-place`}>
            <span className="field-label">{t("saveAs.place")}</span>
            <select
              id={`${id}-place`}
              className="select"
              value={fresh ? NEW : chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              {places.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {label(p)}
                </option>
              ))}
              <option value={NEW}>{t("saveAs.newTheme")}</option>
            </select>
          </label>
          {fresh ? (
            <label className="flex flex-col gap-1" htmlFor={`${id}-theme`}>
              <span className="field-label">{t("kit.newTheme.name")}</span>
              <Input
                id={`${id}-theme`}
                placeholder={t("kit.newTheme.placeholder")}
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
              />
            </label>
          ) : null}
          {nameProblem || themeProblem ? (
            <div role="alert" className="text-xs text-[var(--danger)]">
              {nameProblem
                ? t(`saveAs.errors.${nameProblem}`)
                : t(`kit.newTheme.errors.${themeProblem}`)}
            </div>
          ) : trimmed && !same ? (
            <div
              className="flex flex-col gap-1 text-[13px] text-[var(--text-mut)]"
              data-testid="save-as-effect"
            >
              <p>
                {effect.kind === "added"
                  ? t(place?.kind === "module" ? "saveAs.addedModule" : "saveAs.addedTheme")
                  : place?.kind === "module"
                    ? t("saveAs.replacesInModule", { count: effect.menus })
                    : t("saveAs.replaces", {
                        count: effect.menus,
                        modules: t("saveAs.modules", { count: effect.modules }),
                      })}
              </p>
              {effect.away && effect.kind === "replaces" ? <p>{t("saveAs.away")}</p> : null}
              {effect.overwrites ? (
                <p className="text-[var(--warning)]">{t("saveAs.overwrites")}</p>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="text-xs text-[var(--danger)]">
              {t(`kit.newTheme.errors.${error}`, {
                defaultValue: t("saveAs.failed", { detail: error }),
              })}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t("newProjectDialog.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy ? "…" : t("saveAs.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
