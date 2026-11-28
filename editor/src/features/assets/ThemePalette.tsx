import { ColorInput } from "@/components/ui/color-input";
import { InfoTip } from "@/components/ui/info-tip";
import { ResetButton } from "@/components/ui/reset-button";
import { DEFAULT_PALETTE, PALETTE_FILE, type Palette, readPalette } from "@/lib/pack/palette";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { stringify } from "yaml";
import { writeDraftFile } from "./draftFile";

const NAME = /^[a-z0-9_-]+$/;
const WRITE_AFTER_MS = 400;

/** A `palette.yml` holding `colours`; `null` for none, where the file is taken off. */
export function paletteFile(colours: ReadonlyMap<string, string>): string | null {
  return colours.size === 0 ? null : stringify(Object.fromEntries(colours));
}

export interface ThemePaletteState {
  /** The colours the theme gives itself, as edited: what its `palette.yml` holds or will hold. */
  colours: ReadonlyMap<string, string>;
  /** Whether they differ from what the server has published: they show in game once deployed. */
  drafted: boolean;
  /** Why the last change could not be written to the draft. */
  error: string | null;
  /** Gives the theme its own colour for `name`; `null` takes it back to the place below. */
  set: (name: string, colour: string | null) => void;
}

/**
 * The palette (`lib/pack/palette.ts`) of the theme whose Project is `projectId`, edited from its
 * page: read from the player's draft of that Project when they have one, else from what the
 * server published (`published`, the text of its `palette.yml`). A change shows at once and is
 * written to the draft a moment later (`writeDraftFile`).
 */
export function useThemePalette(
  projectId: string | undefined,
  published: string | undefined,
): ThemePaletteState {
  const draft = useProjectDraftStore((s) => (projectId ? s.drafts[projectId] : undefined));
  const held = draft ? draft.tree[PALETTE_FILE] : published;
  const [edited, setEdited] = useState<{
    projectId: string;
    colours: ReadonlyMap<string, string>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const read = useMemo(() => readPalette(held ?? ""), [held]);
  const colours = edited && edited.projectId === projectId ? edited.colours : read;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const set = useCallback(
    (name: string, colour: string | null) => {
      if (!projectId) return;
      const next = new Map(colours);
      if (colour === null) next.delete(name);
      else next.set(name, colour.toLowerCase());
      setEdited({ projectId, colours: next });
      setError(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        writeDraftFile(projectId, PALETTE_FILE, paletteFile(next))
          .then(() => setEdited((now) => (now?.colours === next ? null : now)))
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
      }, WRITE_AFTER_MS);
    },
    [projectId, colours],
  );

  const drafted = useMemo(() => {
    const was = readPalette(published ?? "");
    return was.size !== colours.size || [...colours].some(([name, c]) => was.get(name) !== c);
  }, [published, colours]);

  return { colours, drafted, error, set };
}

/**
 * The colours of a theme's palette, one row a name: the ones every server has
 * (`DEFAULT_PALETTE`) and the ones the theme adds. A row shows the theme's own colour, else the
 * one it gets from below (`below`: the library, then the default palette); its reset takes the
 * theme's own colour off.
 */
export function ThemePalette({
  state,
  below,
  place = "theme",
  children,
}: {
  state: ThemePaletteState;
  /** What a name is without this theme: the library's colour, else the default one. */
  below: Palette;
  /** `library`: the server's own palette, shown in the library's Project under a title of its own. */
  place?: "theme" | "library";
  /** Shown under the hint: what the colours look like on the base's pieces. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState("");
  const names = useMemo(
    () => [
      ...Object.keys(DEFAULT_PALETTE),
      ...[...state.colours.keys()].filter((name) => !(name in DEFAULT_PALETTE)).sort(),
    ],
    [state.colours],
  );
  const name = adding.trim();
  const addable = NAME.test(name) && !names.includes(name);

  return (
    <section
      className={place === "theme" ? "card flex flex-col gap-2 p-4" : "flex flex-col gap-2"}
      data-testid="kit-theme-palette"
    >
      {place === "theme" ? (
        <div className="flex items-center gap-1">
          <h3 className="eyebrow">{t("kit.theme.palette.title")}</h3>
          <InfoTip content={t("kit.theme.palette.hint")} />
        </div>
      ) : (
        <p className="text-xs text-[var(--text-mut)]">{t("kit.theme.palette.libraryHint")}</p>
      )}
      {children}
      <ul className="flex flex-col gap-1">
        {names.map((entry) => {
          const own = state.colours.get(entry);
          const shown = own ?? below(entry) ?? "#ffffff";
          return (
            <li key={entry} className="flex items-center gap-2 text-xs">
              <ColorInput
                value={shown}
                onChange={(colour) => state.set(entry, colour)}
                label={t("kit.theme.palette.colourOf", { name: entry })}
              />
              <code className="min-w-0 flex-1 truncate">{entry}</code>
              <code className="text-[var(--text-mut)]">{shown}</code>
              <ResetButton
                modified={own !== undefined}
                onReset={() => state.set(entry, null)}
                label={t(
                  place === "theme" ? "kit.theme.palette.reset" : "kit.theme.palette.libraryReset",
                )}
              />
            </li>
          );
        })}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!addable) return;
          state.set(name, below("neutral") ?? "#8b8f98");
          setAdding("");
        }}
      >
        <input
          className="input h-8 min-w-0 flex-1"
          aria-label={t("kit.theme.palette.newName")}
          placeholder={t("kit.theme.palette.newName")}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <button type="submit" className="btn btn-outline btn-sm" disabled={!addable}>
          {t("kit.theme.palette.add")}
        </button>
      </form>
      {state.error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {t("kit.theme.palette.failed", { detail: state.error })}
        </p>
      ) : state.drafted ? (
        <p className="text-xs text-[var(--text-mut)]" data-testid="kit-theme-palette-drafted">
          {t(place === "theme" ? "kit.theme.palette.drafted" : "kit.theme.palette.libraryDrafted")}
        </p>
      ) : null}
    </section>
  );
}
