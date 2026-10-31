import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { Input } from "@/components/ui/input";
import { documentsOf } from "@/domain/documents";
import type { Document, Project, ProjectId } from "@/domain/types";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { resolveItem } from "@/features/canvas/resolveItem";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { collectionLabel } from "@/lib/documentCollections";
import { type KindAppearance, kindAppearance } from "@/lib/documentKindAppearance";
import { plainTextFromMiniMessage } from "@/lib/miniMessage";
import { contributionLabel, documentTitle, kindCreatableIn } from "@/lib/moduleDocumentKinds";
import { projectDestination } from "@/lib/projectNavigation";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useUiStore } from "@/state/uiStore";
import {
  type BoardItem,
  type DocumentKindContribution,
  documentKindContribution,
} from "@artisan/editor-sdk";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResolvedProjectContext } from "../project/ResolvedProjectContext";
import { ProjectScreenForm, screenEditsProject } from "./ProjectScreenView";
import { resolveScreen } from "./screenList";

/** Parts listed on a card before "+N more": enough to recognise a Document at a glance. */
const PREVIEW_ROWS = 5;
/** Past this many Documents, the page offers a filter. */
const FILTER_FROM = 7;

/**
 * The page of a collection kind's Documents in a project (SDK 1.9), a shop's catalogue: the
 * collection's settings screen when it declares one, then a card per Document and the
 * button that creates one. A card shows the Document's parts (`board.items`: a category's
 * articles, a quest group's quests) and opens the Document on its own view.
 */
export function CollectionView({ projectId, kind }: { projectId: ProjectId; kind: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  const resolvedId = useContext(ResolvedProjectContext) ?? projectId;
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === resolvedId));
  const localProjects = useProjectsStore((s) => s.openProjects.projects);
  const declared = useServerScreensStore((s) => s.screens);
  const uiLang = useUiStore((s) => s.editorLang);
  const activeLang = useUiStore((s) => s.activeLang);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const contribution = documentKindContribution(kind);
  const screenId = contribution?.collection?.screen;
  const screen = useMemo(
    () => (screenId ? resolveScreen(screenId, declared, localProjects) : null),
    [screenId, declared, localProjects],
  );

  if (!project || !contribution?.collection) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState title={t("collections.notFound")} />
      </div>
    );
  }

  const label = collectionLabel(contribution, kind, uiLang);
  const kindLabel = contributionLabel(contribution, kind, t, uiLang);
  const docs = documentsOf(project, kind);
  const look = kindAppearance(kind);
  const open = (id: string) => navigate(projectDestination(project, serverId, id, kind));
  const creatable = kindCreatableIn(contribution, project);
  const titleOf = (doc: Document) => documentTitle(contribution, doc, project, activeLang);
  const needle = filter.trim().toLocaleLowerCase();
  const shown = needle
    ? docs.filter((doc) =>
        [doc.id, plainTextFromMiniMessage(titleOf(doc))].some((s) =>
          s.toLocaleLowerCase().includes(needle),
        ),
      )
    : docs;
  const createButton = (
    <button
      type="button"
      className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
      aria-label={t("projectProperties.newDocument", { kind: kindLabel })}
      title={t("projectProperties.newDocument", { kind: kindLabel })}
      onClick={() => setCreating(true)}
    >
      <Plus className="size-4" aria-hidden />
      {t("collections.create")}
    </button>
  );

  return (
    <div className="absolute inset-0 overflow-auto" data-testid="collection-page">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-[var(--page-pad)]">
        <header className="flex flex-wrap items-center gap-3">
          <IconTile icon={look.icon} fg={look.fg} soft={look.soft} line={look.line} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="eyebrow truncate">{project.name}</div>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{label}</h1>
              <span className="badge" title={kindLabel}>
                {docs.length}
              </span>
            </div>
          </div>
          {docs.length >= FILTER_FROM && (
            <div className="relative w-full sm:w-56">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--text-faint)]"
                aria-hidden
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("collections.filter", { collection: label })}
                aria-label={t("collections.filter", { collection: label })}
                className="w-full pl-8"
              />
            </div>
          )}
          {creatable && createButton}
        </header>

        {screen && screenEditsProject(screen, project) && (
          <section className="flex flex-col gap-3" aria-label={screen.label}>
            <h2 className="field-label">{screen.label}</h2>
            <ProjectScreenForm project={project} screen={screen} />
          </section>
        )}

        {docs.length === 0 ? (
          <div className="card">
            <EmptyState
              title={t("collections.empty", { collection: label })}
              hint={creatable ? t("collections.emptyHint") : undefined}
              action={creatable ? createButton : undefined}
            />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState title={t("collections.noMatch", { filter: filter.trim() })} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((doc) => (
              <li key={doc.id} className="flex">
                <CollectionCard
                  doc={doc}
                  project={project}
                  contribution={contribution}
                  look={look}
                  lang={activeLang}
                  title={titleOf(doc)}
                  onOpen={() => open(doc.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && (
        <NewDocumentDialog
          projectId={project.id}
          kind={kind}
          open
          onOpenChange={(o) => {
            if (!o) setCreating(false);
          }}
          onCreated={open}
        />
      )}
    </div>
  );
}

/** One Document of the collection: its title, its summary, its first parts. */
function CollectionCard({
  doc,
  project,
  contribution,
  look,
  lang,
  title,
  onOpen,
}: {
  doc: Document;
  project: Project;
  contribution: DocumentKindContribution;
  look: KindAppearance;
  lang: string;
  title: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const ctx = { project, lang };
  const summary = contribution.board?.summary?.(doc, ctx);
  const items = contribution.board?.items?.(doc, ctx) ?? null;
  const rows = items?.slice(0, PREVIEW_ROWS) ?? [];
  const more = (items?.length ?? 0) - rows.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card group flex w-full flex-col overflow-hidden text-left transition-colors hover:bg-[var(--surface-hover)]"
      style={{ borderTop: `2px solid ${look.line}` }}
    >
      <span className="flex w-full items-start gap-3 p-3.5">
        <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="md" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <MiniMessageInline
            source={title}
            className="truncate text-[13.5px] font-semibold text-[var(--text)]"
          />
          <span className="truncate text-[12px] text-[var(--text-mut)]">{summary ?? doc.id}</span>
        </span>
        {summary != null && title !== doc.id && (
          <span className="mono shrink-0 pt-0.5 text-[10.5px] text-[var(--text-faint)]">
            {doc.id}
          </span>
        )}
      </span>
      {items && (
        <span className="flex w-full flex-1 flex-col border-t border-[var(--border-soft)] px-3.5 py-2">
          {rows.length === 0 ? (
            <span className="py-1 text-[12px] text-[var(--text-faint)]">
              {t("collections.noParts")}
            </span>
          ) : (
            rows.map((row) => (
              <CardRow key={row.id} row={row} project={project} lang={lang} look={look} />
            ))
          )}
          {more > 0 && (
            <span className="pt-1 text-[11.5px] text-[var(--text-faint)]">
              {t("collections.more", { count: more })}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/** A part of a card: its rank or item, its label and caption, its detail. */
function CardRow({
  row,
  project,
  lang,
  look,
}: {
  row: BoardItem;
  project: Project;
  lang: string;
  look: KindAppearance;
}) {
  return (
    <span className="flex w-full items-center gap-2.5 py-1">
      {row.marker != null ? (
        <span
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
          style={{
            color: "var(--text)",
            background: look.soft,
            boxShadow: `inset 0 0 0 1px ${look.line}`,
          }}
        >
          {row.marker}
        </span>
      ) : row.icon != null ? (
        <ItemThumb value={row.icon} project={project} lang={lang} />
      ) : (
        <span className="inline-flex size-5 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-1.5 rounded-full" style={{ background: look.fg }} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] text-[var(--text)]">{row.label}</span>
        {row.caption && (
          <span className="truncate text-[11px] text-[var(--text-faint)]">{row.caption}</span>
        )}
      </span>
      {row.detail && (
        <span className="shrink-0 text-[11px] text-[var(--text-mut)]">{row.detail}</span>
      )}
    </span>
  );
}

/** A part's item (`BoardItem.icon`), resolved like on the board: its texture, else its letters. */
function ItemThumb({ value, project, lang }: { value: unknown; project: Project; lang: string }) {
  const resolved = useMemo(() => {
    try {
      return resolveItem(value, {}, project, lang);
    } catch {
      return { lore: [] as string[] };
    }
  }, [value, project, lang]);
  const material = resolved.material ?? "";
  const materialUrl = useTextureUrl(material);
  const url = useHeadPreviewUrl(resolved.head) ?? materialUrl;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="size-5 shrink-0"
        style={{ imageRendering: "pixelated" }}
        draggable={false}
      />
    );
  }
  return (
    <span className="mono inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-[var(--surface-raised-2)] text-[8px] text-[var(--text-faint)]">
      {material.replace(/^.*:/, "").slice(0, 2)}
    </span>
  );
}
