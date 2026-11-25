import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KIT_FOLDER } from "@/lib/pack/kit";
import { isThemeName } from "@/lib/pack/theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Renames a theme of its own folder, or takes it off the server: the two things that move the
 * folder `themes/<name>/` itself. The server keeps a deleted theme in its trash
 * (`themes/.artisan-trash/`). Each callback rejects with the refusal's code, shown here.
 */
export function ThemeMoves({
  name,
  inPlace,
  taken = [],
  onRename,
  onDelete,
}: {
  name: string;
  /** Whether the theme is in place: the server's pack is rebuilt once it is renamed or gone. */
  inPlace: boolean;
  /** The server's themes: a new name among them is refused before the request. */
  taken?: readonly string[];
  onRename?: (target: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState<"rename" | "delete" | null>(null);
  const [target, setTarget] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = target.trim();
  const problem =
    !trimmed || trimmed === name
      ? null
      : !isThemeName(trimmed) || trimmed === KIT_FOLDER
        ? "invalid_path"
        : taken.includes(trimmed)
          ? "destination_exists"
          : null;
  const shown = error ?? (asked === "rename" ? problem : null);

  const ask = (what: "rename" | "delete" | null) => {
    if (busy) return;
    setAsked(what);
    setError(null);
    setTarget(name);
  };

  const run = async (change: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await change();
      setAsked(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  if (!onRename && !onDelete) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="theme-moves">
      {onRename ? (
        <Button variant="outline" size="sm" onClick={() => ask("rename")}>
          {t("kit.theme.moves.rename")}
        </Button>
      ) : null}
      {onDelete ? (
        <Button variant="outline" size="sm" onClick={() => ask("delete")}>
          {t("kit.theme.moves.delete")}
        </Button>
      ) : null}
      <Dialog open={asked !== null} onOpenChange={(open) => (open ? undefined : ask(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                asked === "delete" ? "kit.theme.moves.deleteTitle" : "kit.theme.moves.renameTitle",
                {
                  name,
                },
              )}
            </DialogTitle>
            <DialogDescription>
              {asked === "delete"
                ? t(inPlace ? "kit.theme.moves.deleteInPlace" : "kit.theme.moves.deleteIntro", {
                    name,
                  })
                : t(inPlace ? "kit.theme.moves.renameInPlace" : "kit.theme.moves.renameIntro")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (asked === "delete" && onDelete) void run(onDelete);
              else if (asked === "rename" && onRename && trimmed && trimmed !== name && !problem)
                void run(() => onRename(trimmed));
            }}
          >
            {asked === "rename" ? (
              <Input
                aria-label={t("kit.newTheme.name")}
                value={target}
                disabled={busy}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setError(null);
                }}
              />
            ) : null}
            {shown ? (
              <div role="alert" className="text-xs text-[var(--danger)]">
                {t(`kit.theme.moves.errors.${shown}`, {
                  defaultValue: t("kit.theme.moves.errors.failed"),
                })}
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => ask(null)} disabled={busy}>
                {t("newProjectDialog.cancel")}
              </Button>
              {asked === "delete" ? (
                <Button type="submit" variant="destructive" disabled={busy}>
                  {busy ? "…" : t("kit.theme.moves.delete")}
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !trimmed || trimmed === name || !!problem}
                >
                  {busy ? "…" : t("kit.theme.moves.rename")}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
