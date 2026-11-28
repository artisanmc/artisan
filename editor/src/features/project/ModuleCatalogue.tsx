import { IconTile } from "@/components/ui/icon-tile";
import { Segmented } from "@/components/ui/segmented";
import { docKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { useUiStore } from "@/state/uiStore";
import { LayoutGrid, List, type LucideIcon, Plus, Puzzle, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { CataloguePreview } from "./CataloguePreview";
import { originLabelOf, typeLabel, useOriginOf } from "./ProjectDocumentTree";
import { buildProjectDocuments } from "./useProjectDocuments";

/**
 * Every Document of a module, kind after kind, as cards: the module's way in. A search and one
 * chip per kind narrow it (`kind` is the page's `?kind=`, so a kind of the sidebar is a link);
 * a card opens its Document. A module's collections (quest groups, speakers…) are kinds like
 * the others here: their own chip, their cards, found by the search.
 */
export function ModuleCatalogue({
  project,
  kind,
  onKind,
  onOpen,
  serverId,
  collections = [],
  onCreate,
  places = [],
}: {
  /**
   * What the module holds that is not a Document (its settings screens, its data sources):
   * entries of the catalogue all the same, one filter and one heading each (`?kind=<kind>`).
   */
  places?: CataloguePlace[];
  project: Project;
  /** Kinds kept in the catalogue even with no Document yet (the module's collections), with whether each may be created here. */
  collections?: { kind: string; creatable: boolean }[];
  /** "New" on a creatable kind's heading. */
  onCreate?: (kind: string) => void;
  /** The kind shown alone; every kind when absent. */
  kind: string | undefined;
  onKind: (kind: string | undefined) => void;
  /** Its argument: the Document's key (`docKey`). */
  onOpen: (documentKey: string) => void;
  /** The module's server: a menu's card draws it in grid mode only with one. */
  serverId?: string;
}) {
  const { t } = useTranslation();
  const activeLang = useUiStore((s) => s.activeLang);
  const originOf = useOriginOf(project);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useCatalogueLayout();
  const [size, setSize] = useCatalogueSize();
  const kept = new Map(collections.map((c) => [c.kind, c.creatable]));
  const built = buildProjectDocuments(project, activeLang);
  for (const kind of kept.keys())
    if (!built.some((g) => g.type === kind)) built.push({ type: kind, items: [] });
  const groups = built.filter((g) => g.items.length > 0 || kept.has(g.type));
  const needle = query.trim().toLowerCase();
  const shown = groups
    .filter((g) => !kind || g.type === kind)
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (it) =>
          !needle ||
          it.label.toLowerCase().includes(needle) ||
          it.id.toLowerCase().includes(needle) ||
          it.folder.toLowerCase().includes(needle),
      ),
    }))
    .filter((g) => g.items.length > 0 || (!needle && kept.has(g.type)));
  const shownPlaces = places
    .filter((pl) => !kind || kind === pl.kind)
    .map((pl) => ({
      ...pl,
      items: pl.items.filter((it) => !needle || it.label.toLowerCase().includes(needle)),
    }))
    .filter((pl) => pl.items.length > 0);
  if (groups.length === 0 && places.length === 0) return null;
  return (
    <section
      data-testid="module-catalogue"
      className="flex flex-col gap-3"
      aria-labelledby="module-catalogue-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="module-catalogue-title" className="field-label mr-auto">
          {t("moduleCatalogue.title")}
        </h2>
        <Segmented
          label={t("moduleCatalogue.layout")}
          value={layout}
          onChange={setLayout}
          options={[
            {
              value: "list",
              label: <List className="size-3.5" aria-label={t("moduleCatalogue.list")} />,
              title: t("moduleCatalogue.list"),
            },
            {
              value: "grid",
              label: <LayoutGrid className="size-3.5" aria-label={t("moduleCatalogue.grid")} />,
              title: t("moduleCatalogue.grid"),
            },
          ]}
        />
        {layout === "grid" && (
          <Segmented
            label={t("moduleCatalogue.size")}
            value={size}
            onChange={setSize}
            options={(["s", "m", "l"] as const).map((v) => ({
              value: v,
              label: t(`moduleCatalogue.sizes.${v}`),
              title: t(`moduleCatalogue.sizeHint.${v}`),
            }))}
          />
        )}
        <label className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--text-faint)]"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("moduleCatalogue.search")}
            aria-label={t("moduleCatalogue.search")}
            className="input h-8 w-52 pl-8 text-[13px]"
          />
        </label>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a row of toggle chips, not a form fieldset */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("moduleCatalogue.kinds")}>
        <button
          type="button"
          className={`chip ${kind ? "" : "is-active"}`}
          aria-pressed={!kind}
          onClick={() => onKind(undefined)}
        >
          {t("moduleCatalogue.all")}
        </button>
        {places.map((pl) => (
          <button
            key={pl.kind}
            type="button"
            data-testid={`catalogue-kind-${pl.kind}`}
            className={`chip ${kind === pl.kind ? "is-active" : ""}`}
            aria-pressed={kind === pl.kind}
            onClick={() => onKind(kind === pl.kind ? undefined : pl.kind)}
          >
            {pl.label} {pl.items.length}
          </button>
        ))}
        {groups.map((g) => (
          <button
            key={g.type}
            type="button"
            data-testid={`catalogue-kind-${g.type}`}
            className={`chip ${kind === g.type ? "is-active" : ""}`}
            aria-pressed={kind === g.type}
            onClick={() => onKind(kind === g.type ? undefined : g.type)}
          >
            {typeLabel(g.type, t)} {g.items.length}
          </button>
        ))}
      </div>
      {shown.length === 0 && shownPlaces.length === 0 ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("moduleCatalogue.none")}</p>
      ) : (
        shown.map((g) => {
          const look = kindAppearance(g.type);
          return (
            <div key={g.type} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[12px] font-medium text-[var(--text-mut)]">
                  {typeLabel(g.type, t)} · {g.items.length}
                </h3>
                {onCreate && kept.get(g.type) && (
                  <button
                    type="button"
                    data-testid={`catalogue-new-${g.type}`}
                    className="btn btn-ghost btn-sm inline-flex items-center gap-1"
                    onClick={() => onCreate(g.type)}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {t("collections.create")}
                  </button>
                )}
              </div>
              {g.items.length === 0 && (
                <p className="text-[13px] text-[var(--text-mut)]">
                  {t("collections.empty", { collection: typeLabel(g.type, t) })}
                </p>
              )}
              <ul
                aria-label={typeLabel(g.type, t)}
                className="grid gap-2"
                style={{
                  gridTemplateColumns:
                    layout === "grid"
                      ? `repeat(auto-fill, minmax(${GRID_MIN[size]}, 1fr))`
                      : "repeat(auto-fill, minmax(14rem, 1fr))",
                }}
              >
                {g.items.map((it) => {
                  const key = docKey(g.type, it.id);
                  const origin = originOf(key);
                  const mark = origin && origin.tone !== "identical" ? origin : null;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        data-testid={`catalogue-doc-${key}`}
                        onClick={() => onOpen(key)}
                        className={`card flex w-full flex-col text-left hover:border-[var(--border-strong)] ${
                          layout === "grid" ? "gap-1.5 p-2" : "gap-2 p-2.5"
                        }`}
                      >
                        {layout === "grid" && (
                          <CataloguePreview
                            project={project}
                            kind={g.type}
                            id={it.id}
                            serverId={serverId}
                          />
                        )}
                        {/* One row, grid or list: the marks sit on the name's line, never below. */}
                        <span className="flex w-full items-center gap-2">
                          {layout === "list" && (
                            <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="sm" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">
                              {it.label}
                            </span>
                            {it.folder && (
                              <span className="block truncate text-[11px] text-[var(--text-faint)]">
                                {it.folder}
                              </span>
                            )}
                          </span>
                          {mark && (
                            <span
                              className="badge shrink-0"
                              title={originLabelOf(mark, t)}
                              data-testid="catalogue-doc-mark"
                            >
                              {t(`moduleCatalogue.tone.${mark.tone}`)}
                            </span>
                          )}
                          {origin?.system && (
                            <Puzzle
                              className="size-3 shrink-0 text-[var(--text-faint)]"
                              aria-label={originLabelOf(origin, t)}
                            />
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
      {shownPlaces.map((pl) => (
        <div key={pl.kind} className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-[var(--text-mut)]">
            {pl.label} · {pl.items.length}
          </h3>
          <ul
            aria-label={pl.label}
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))" }}
          >
            {pl.items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  data-testid={`catalogue-${pl.kind}-${it.id}`}
                  onClick={() => pl.onOpen(it.id)}
                  className="card flex w-full items-center gap-2 p-2.5 text-left hover:border-[var(--border-strong)]"
                >
                  {it.visual ?? (
                    <IconTile
                      icon={pl.icon}
                      fg="var(--text-mut)"
                      soft="var(--surface-raised-2)"
                      size="sm"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {it.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** A place of the module that is not a Document kind: its entries, listed like Documents. */
export interface CataloguePlace {
  /** The `?kind=` of its filter. */
  kind: string;
  label: string;
  icon: LucideIcon;
  /** `visual` replaces the place's icon on an entry (a captured item's picture). */
  items: { id: string; label: string; visual?: ReactNode }[];
  onOpen: (id: string) => void;
}

type Layout = "list" | "grid";
const LAYOUT_KEY = "artisan.catalogue.layout";

/** The catalogue's layout, kept in this browser: a convenience, the page works without it. */
function useCatalogueLayout(): [Layout, (layout: Layout) => void] {
  const [layout, set] = useState<Layout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  return [
    layout,
    (next) => {
      set(next);
      try {
        localStorage.setItem(LAYOUT_KEY, next);
      } catch {
        // Private window or blocked storage: the layout lasts until the page closes.
      }
    },
  ];
}

type Size = "s" | "m" | "l";
/** The narrowest a grid card gets: how many fit a row follows (about 7, 5 and 3 on a wide screen). */
const GRID_MIN: Record<Size, string> = { s: "9.5rem", m: "13rem", l: "20rem" };
const SIZE_KEY = "artisan.catalogue.size";

/** The grid's card size, kept in this browser like the layout. */
function useCatalogueSize(): [Size, (size: Size) => void] {
  const [size, set] = useState<Size>(() => {
    try {
      const v = localStorage.getItem(SIZE_KEY);
      return v === "s" || v === "l" ? v : "m";
    } catch {
      return "m";
    }
  });
  return [
    size,
    (next) => {
      set(next);
      try {
        localStorage.setItem(SIZE_KEY, next);
      } catch {
        // Private window or blocked storage: the size lasts until the page closes.
      }
    },
  ];
}
