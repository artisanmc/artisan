import { IconTile } from "@/components/ui/icon-tile";
import { Segmented } from "@/components/ui/segmented";
import { docKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { useUiStore } from "@/state/uiStore";
import { LayoutGrid, List, Puzzle, Search } from "lucide-react";
import { useState } from "react";
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
}: {
  project: Project;
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
  const groups = buildProjectDocuments(project, activeLang).filter((g) => g.items.length > 0);
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
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;
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
      {shown.length === 0 ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("moduleCatalogue.none")}</p>
      ) : (
        shown.map((g) => {
          const look = kindAppearance(g.type);
          return (
            <div key={g.type} className="flex flex-col gap-2">
              <h3 className="text-[12px] font-medium text-[var(--text-mut)]">
                {typeLabel(g.type, t)} · {g.items.length}
              </h3>
              <ul
                aria-label={typeLabel(g.type, t)}
                className={
                  layout === "grid"
                    ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                    : "grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4"
                }
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
                        className={`card flex w-full gap-2 p-2.5 text-left hover:border-[var(--border-strong)] ${
                          layout === "grid" ? "flex-col" : "items-center"
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
                        {layout === "list" && (
                          <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="sm" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{it.label}</span>
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
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
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
