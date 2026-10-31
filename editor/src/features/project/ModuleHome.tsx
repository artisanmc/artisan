import { ModuleIcon, ModuleLogo, useModuleBrand } from "@/components/ArtisanWordmark";
import { ownerModuleOf } from "@/components/projectOwnership";
import { IconTile } from "@/components/ui/icon-tile";
import { projectNamespace } from "@/domain/docRef";
import { allDocuments, docKey, documentsOf } from "@/domain/documents";
import { listFolders } from "@/domain/folders";
import { listedDataSources } from "@/domain/projectData";
import type { Project } from "@/domain/types";
import { BoardThumbnail } from "@/features/canvas/BoardThumbnail";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { collectionLabel, isCollectionKind, projectCollections } from "@/lib/documentCollections";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { listLanguages } from "@/lib/i18nUsages";
import { kindCreatableIn } from "@/lib/moduleDocumentKinds";
import {
  collectionDestination,
  dataSourceDestination,
  screenDestination,
} from "@/lib/projectNavigation";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useUiStore } from "@/state/uiStore";
import { type DocumentKindContribution, getModule } from "@artisan/editor-sdk";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Blocks, Database, LayoutDashboard, Plus, Settings, Zap } from "lucide-react";
import { Component, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { typeLabel } from "./ProjectDocumentTree";
import { goToDocument } from "./goToDocument";
import { documentLabel } from "./useProjectDocuments";

/**
 * A module's entry view (`?tab=` absent, at the module's root): what the module holds and
 * what it gives the server, built from what is already declared (kinds, collections,
 * screens, data sources, commands, actions). One block per place of the module, never a
 * row per Document: the left bar lists the Documents, the home says how many there are
 * and leads to the page that edits them.
 */
export function ModuleHome({
  project,
  onOpenBoard,
}: { project: Project; onOpenBoard: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  const uiLang = useUiStore((s) => s.editorLang);
  const activeLang = useUiStore((s) => s.activeLang);
  const screens = useServerScreensStore((s) => s.screens);
  const actions = useServerActionsStore((s) => s.actions);
  const [creating, setCreating] = useState<string | null>(null);

  const owner = ownerModuleOf(
    { id: projectNamespace(project), ownerModule: project.ownerModule },
    screens,
  );
  const ownerModule = owner ? getModule(owner) : undefined;
  const ownerLabel = owner ? (ownerModule?.displayName ?? owner) : null;
  const OwnSection = ownerModule?.home;
  const brand = useModuleBrand(owner);
  const collections = projectCollections(project);

  // The board's Documents: every kind but the collections, which have no node there.
  const boardCounts = new Map<string, number>();
  for (const { kind } of allDocuments(project))
    if (!isCollectionKind(kind)) boardCounts.set(kind, (boardCounts.get(kind) ?? 0) + 1);
  const boardTotal = [...boardCounts.values()].reduce((a, b) => a + b, 0);
  // A board worth looking at holds more than commands: menus, dialogs, linked to each other.
  // It leads the page, wide and with its picture; otherwise the lists come first and the
  // board, a few commands at most, closes the content.
  const boardFirst = [...boardCounts.keys()].some((kind) => kind !== "command");
  const folderCount = listFolders(project).filter((p) => !p.includes("/")).length;

  // A collection shows its own settings screen at the top of its page: not twice.
  const collectionScreens = new Set(collections.flatMap((c) => c.collection?.screen ?? []));
  const ns = projectNamespace(project);
  const moduleScreens = screens.filter(
    (s) =>
      !collectionScreens.has(s.id) && (s.projectId === ns || (!!owner && s.moduleId === owner)),
  );
  const dataSources = listedDataSources(project, screens);

  const commands = documentsOf(project, "command");
  const moduleActions = owner ? actions.filter((a) => a.moduleId === owner) : [];
  const languages = listLanguages(project);

  const boardPlace = (
    <Place
      testId="module-home-board"
      wide={boardFirst}
      icon={
        <IconTile
          icon={LayoutDashboard}
          fg="var(--text-mut)"
          soft="var(--surface-raised-2)"
          size="sm"
        />
      }
      title={t("project.tabs.canvas")}
      count={boardTotal}
      summary={
        boardTotal === 0
          ? t("moduleHome.boardEmpty")
          : [
              ...[...boardCounts].map(([kind, n]) => `${typeLabel(kind, t)} ${n}`),
              ...(folderCount > 0 ? [t("moduleHome.folders", { count: folderCount })] : []),
            ].join(" · ")
      }
      picture={
        boardFirst ? (
          <button
            type="button"
            onClick={onOpenBoard}
            aria-label={t("moduleHome.openBoard")}
            className="block h-44 w-full overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-inset)] p-2 hover:border-[var(--border-strong)]"
          >
            <BoardThumbnail project={project} className="h-full w-full" />
          </button>
        ) : undefined
      }
    >
      <button type="button" className="btn btn-outline btn-sm" onClick={onOpenBoard}>
        {t("moduleHome.openBoard")}
      </button>
    </Place>
  );

  return (
    <div
      data-testid="module-home"
      className="absolute inset-0 z-30 overflow-auto bg-[var(--surface)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-7 p-[var(--page-pad)]">
        <header className="flex flex-wrap items-center gap-3">
          {/* A module of the suite shows its own icon and logo; any other one, the tile. */}
          {brand?.icon ? (
            <ModuleIcon src={brand.icon} />
          ) : (
            <IconTile
              icon={Blocks}
              fg="var(--brand)"
              soft="var(--brand-soft)"
              line="var(--brand-line)"
              size="lg"
            />
          )}
          <div className="min-w-0 flex-1">
            {brand?.logo ? (
              <h1 className="mb-1.5 flex">
                <ModuleLogo logo={brand.logo} alt={project.name} />
              </h1>
            ) : (
              <h1 className="truncate text-lg font-semibold">{project.name}</h1>
            )}
            <div className="flex flex-wrap gap-x-3 text-[12.5px] text-[var(--text-mut)]">
              <span>
                {ownerLabel
                  ? t("moduleHome.pluginModule", { name: ownerLabel })
                  : t("moduleHome.contentModule")}
              </span>
              <span className="font-mono">{languages.join(" · ")}</span>
            </div>
          </div>
        </header>

        {OwnSection && (
          <div data-testid="module-home-own">
            <LeaveOutOnError>
              <OwnSection projectId={project.id} />
            </LeaveOutOnError>
          </div>
        )}

        <section className="flex flex-col gap-2.5" aria-labelledby="module-home-content">
          <h2 id="module-home-content" className="field-label">
            {t("moduleHome.content")}
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {boardFirst && boardPlace}
            {collections.map((c) => (
              <CollectionPlace
                key={c.kind}
                project={project}
                contribution={c}
                label={collectionLabel(c, c.kind, uiLang)}
                serverId={serverId}
                onCreate={() => setCreating(c.kind)}
              />
            ))}
            {moduleScreens.length > 0 && (
              <Place
                testId="module-home-settings"
                icon={
                  <IconTile
                    icon={Settings}
                    fg="var(--text-mut)"
                    soft="var(--surface-raised-2)"
                    size="sm"
                  />
                }
                // One screen: the block is that screen, its button only opens it.
                title={
                  moduleScreens.length === 1 ? moduleScreens[0]!.label : t("moduleHome.settings")
                }
              >
                {serverId &&
                  moduleScreens.map((s) => (
                    <Link
                      key={s.id}
                      {...screenDestination(s, serverId, [project])}
                      className="btn btn-outline btn-sm"
                    >
                      {moduleScreens.length === 1 ? t("moduleHome.open") : s.label}
                    </Link>
                  ))}
              </Place>
            )}
            {dataSources.length > 0 && (
              <Place
                testId="module-home-sources"
                icon={
                  <IconTile
                    icon={Database}
                    fg="var(--text-mut)"
                    soft="var(--surface-raised-2)"
                    size="sm"
                  />
                }
                title={t("moduleHome.dataSources")}
                count={dataSources.length}
              >
                {serverId &&
                  dataSources.map((d) => (
                    <Link
                      key={String(d.id)}
                      {...dataSourceDestination(project, serverId, String(d.id))}
                      className="btn btn-outline btn-sm"
                    >
                      {d.name || String(d.id)}
                    </Link>
                  ))}
              </Place>
            )}
            {!boardFirst && boardPlace}
          </ul>
        </section>

        {(commands.length > 0 || moduleActions.length > 0) && (
          <section className="flex flex-col gap-2.5" aria-labelledby="module-home-exposes">
            <h2 id="module-home-exposes" className="field-label">
              {t("moduleHome.exposes")}
            </h2>
            <ul className="flex flex-wrap gap-2" data-testid="module-home-exposes">
              {commands.map((c) => {
                const look = kindAppearance("command");
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="chip inline-flex items-center gap-1.5"
                      onClick={() =>
                        goToDocument(navigate, { serverId, project, ref: docKey("command", c.id) })
                      }
                    >
                      <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="xs" />
                      <span className="font-mono">
                        {documentLabel(project, docKey("command", c.id), activeLang)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {moduleActions.map((a) => (
                <li
                  key={a.name}
                  className="chip inline-flex items-center gap-1.5"
                  title={t("moduleHome.actionHint")}
                >
                  <IconTile
                    icon={Zap}
                    fg="var(--text-mut)"
                    soft="var(--surface-raised-2)"
                    size="xs"
                  />
                  <span className="font-mono">{a.name}</span>
                  <span className="text-[var(--text-faint)]">{t("moduleHome.action")}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {creating && (
        <NewDocumentDialog
          projectId={project.id}
          kind={creating}
          open
          onOpenChange={(o) => {
            if (!o) setCreating(null);
          }}
          onCreated={(id) =>
            goToDocument(navigate, { serverId, project, ref: docKey(creating, id) })
          }
        />
      )}
    </div>
  );
}

/** One place of the module: its name, how many things it holds, a line about them, its links. */
function Place({
  testId,
  wide,
  picture,
  icon,
  title,
  count,
  summary,
  children,
}: {
  testId?: string;
  /** Spans two columns: the place the module is mostly about. */
  wide?: boolean;
  /** A picture of the place, above its links. */
  picture?: ReactNode;
  icon: ReactNode;
  title: string;
  count?: number;
  summary?: string;
  children?: ReactNode;
}) {
  return (
    <li
      className={`card flex flex-col gap-2.5 p-3.5 ${wide ? "md:col-span-2" : ""}`}
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <span className="flex shrink-0" aria-hidden>
          {icon}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</h3>
        {count != null && <span className="badge tabular-nums">{count}</span>}
      </div>
      {summary && <p className="text-[12.5px] text-[var(--text-mut)]">{summary}</p>}
      {picture}
      {children && <div className="mt-auto flex flex-wrap gap-1.5">{children}</div>}
    </li>
  );
}

/** A collection's block: its count, its page, and "New" where the kind may be created. */
function CollectionPlace({
  project,
  contribution,
  label,
  serverId,
  onCreate,
}: {
  project: Project;
  contribution: DocumentKindContribution;
  label: string;
  serverId: string | undefined;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const look = kindAppearance(contribution.kind);
  const count = documentsOf(project, contribution.kind).length;
  return (
    <Place
      testId={`module-home-collection-${contribution.kind}`}
      icon={<IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="sm" />}
      title={label}
      count={count}
      summary={count === 0 ? t("collections.empty", { collection: label }) : undefined}
    >
      {serverId && (
        <Link
          {...collectionDestination(project, serverId, contribution.kind)}
          className="btn btn-outline btn-sm"
        >
          {t("moduleHome.openList")}
        </Link>
      )}
      {kindCreatableIn(contribution, project) && (
        <button
          type="button"
          className="btn btn-ghost btn-sm inline-flex items-center gap-1"
          onClick={onCreate}
        >
          <Plus className="size-3.5" aria-hidden />
          {t("collections.create")}
        </button>
      )}
    </Place>
  );
}

/**
 * A module's own section (`FrontendModule.home`) that throws is left out: the blocks the
 * host builds still lead to every page of the module.
 */
class LeaveOutOnError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("A module's home section failed", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
