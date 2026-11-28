import { ModuleIcon, ModuleLogo, useModuleBrand } from "@/components/ArtisanWordmark";
import { ownerModuleOf } from "@/components/projectOwnership";
import { IconTile } from "@/components/ui/icon-tile";
import { projectNamespace } from "@/domain/docRef";
import { docKey, documentsOf } from "@/domain/documents";
import { listedDataSources } from "@/domain/projectData";
import type { Project } from "@/domain/types";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { moduleScreensOf } from "@/features/project/moduleScreens";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { collectionLabel, projectCollections } from "@/lib/documentCollections";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { kindCreatableIn } from "@/lib/moduleDocumentKinds";
import {
  collectionDestination,
  dataSourceDestination,
  screenDestination,
} from "@/lib/projectNavigation";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useUiStore } from "@/state/uiStore";
import { type DocumentKindContribution, getModule } from "@artisan/editor-sdk";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Blocks, ChevronRight, Database, Package, Plus, Settings, Zap } from "lucide-react";
import { Component, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModuleCatalogue } from "./ModuleCatalogue";
import { goToDocument } from "./goToDocument";
import { type PreviewLine, screenPreview } from "./screenPreview";
import { useGoToWorkspaceTab } from "./useGoToWorkspaceTab";

/**
 * A module's entry view (`?tab=` absent, at the module's root): what the module holds and
 * what it gives the server, built from what is already declared (kinds, collections,
 * screens, data sources, commands, actions). One block per place of the module, never a
 * row per Document in those blocks: above them the catalogue (`ModuleCatalogue`) lists every
 * Document as a card, kind after kind, with a search and a filter by kind; the left bar lists
 * the same Documents for switching from one to another.
 */
export function ModuleHome({ project: opened }: { project: Project }) {
  const { t } = useTranslation();
  // The store's version, not the one the page opened: Documents adopted once a module's kinds
  // arrive (a module page loaded directly), or created here, land there.
  const project =
    useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === opened.id)) ?? opened;
  const navigate = useNavigate();
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  // `?kind=` narrows the catalogue to one kind: a kind of the sidebar links to it.
  const { kind: shownKind } = useSearch({ strict: false }) as { kind?: string };
  const uiLang = useUiStore((s) => s.editorLang);
  const screens = useServerScreensStore((s) => s.screens);
  const actions = useServerActionsStore((s) => s.actions);
  const [creating, setCreating] = useState<string | null>(null);

  const owner = ownerModuleOf(
    { id: projectNamespace(project), ownerModule: project.ownerModule },
    screens,
  );
  const ownerModule = owner ? getModule(owner) : undefined;
  const OwnSection = ownerModule?.home;
  const brand = useModuleBrand(owner);
  const collections = projectCollections(project);

  // A collection shows its own settings screen at the top of its page: not twice.
  const moduleScreens = moduleScreensOf(project, screens);
  const dataSources = listedDataSources(project, screens);

  const goToTab = useGoToWorkspaceTab();
  const captured = project.capturedItems ?? [];

  const moduleActions = owner ? actions.filter((a) => a.moduleId === owner) : [];

  return (
    <div
      data-testid="module-home"
      className="absolute inset-0 z-30 overflow-auto bg-[var(--surface)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-7 p-[var(--page-pad)]">
        {/* The module's icon and its logo (or its name), side by side, centred on each other. */}
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
              <h1 className="flex">
                <ModuleLogo logo={brand.logo} alt={project.name} />
              </h1>
            ) : (
              <h1 className="truncate text-lg font-semibold">{project.name}</h1>
            )}
          </div>
        </header>

        {OwnSection && (
          <div data-testid="module-home-own">
            <LeaveOutOnError>
              <OwnSection projectId={project.id} />
            </LeaveOutOnError>
          </div>
        )}

        <ModuleCatalogue
          project={project}
          serverId={serverId}
          kind={shownKind}
          onKind={(kind) =>
            navigate({
              to: ".",
              search: (prev) => ({ ...(prev as object), kind }) as never,
            })
          }
          onOpen={(ref) => goToDocument(navigate, { serverId, project, ref })}
        />

        <section className="flex flex-col gap-2.5" aria-labelledby="module-home-content">
          <h2 id="module-home-content" className="field-label">
            {t("moduleHome.content")}
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
              <SettingsPlace project={project} screens={moduleScreens} serverId={serverId} />
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
            {captured.length > 0 && (
              <Place
                testId="module-home-captured"
                icon={
                  <IconTile
                    icon={Package}
                    fg="var(--text-mut)"
                    soft="var(--surface-raised-2)"
                    size="sm"
                  />
                }
                title={t("moduleHome.captured")}
                count={captured.length}
                summary={t("moduleHome.capturedHint")}
              >
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => goToTab("items")}
                >
                  {t("moduleHome.openCaptured")}
                </button>
              </Place>
            )}
          </ul>
        </section>

        {moduleActions.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-labelledby="module-home-exposes">
            <h2 id="module-home-exposes" className="field-label">
              {t("moduleHome.exposes")}
            </h2>
            <ul className="flex flex-wrap gap-2" data-testid="module-home-exposes">
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

/**
 * The module's settings screens: what each one holds, at a glance (its first values, how
 * many entries its lists have), read from the Project's copy of its file. Each screen is a
 * row that opens it. One screen: the block is that screen, named after it.
 */
function SettingsPlace({
  project,
  screens,
  serverId,
}: {
  project: Project;
  screens: ServerEditorScreen[];
  serverId: string | undefined;
}) {
  const { t } = useTranslation();
  const lone = screens.length === 1 ? screens[0] : undefined;
  return (
    <Place
      testId="module-home-settings"
      icon={
        <IconTile icon={Settings} fg="var(--text-mut)" soft="var(--surface-raised-2)" size="sm" />
      }
      title={lone ? lone.label : t("moduleHome.settings")}
      count={lone ? undefined : screens.length}
      summary={t("moduleHome.settingsHint")}
      picture={
        lone ? (
          <ScreenValues project={project} screen={lone} />
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="module-home-screens">
            {screens.map((s) => (
              <li key={s.id}>
                <ScreenRow project={project} screen={s} serverId={serverId} />
              </li>
            ))}
          </ul>
        )
      }
    >
      {lone && serverId && (
        <Link {...screenDestination(lone, serverId, [project])} className="btn btn-outline btn-sm">
          {t("moduleHome.open")}
        </Link>
      )}
    </Place>
  );
}

/** One screen among several: its name, its values below, the whole row opens it. */
function ScreenRow({
  project,
  screen,
  serverId,
}: {
  project: Project;
  screen: ServerEditorScreen;
  serverId: string | undefined;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">
          {screen.label}
        </span>
        {serverId && (
          <ChevronRight
            className="size-3.5 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-mut)]"
            aria-hidden
          />
        )}
      </span>
      <ScreenValues project={project} screen={screen} />
    </>
  );
  const frame =
    "flex flex-col gap-1.5 rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2.5 py-2";
  return serverId ? (
    <Link
      {...screenDestination(screen, serverId, [project])}
      className={`group ${frame} hover:border-[var(--border-strong)]`}
      data-testid={`module-home-screen-${screen.id}`}
    >
      {body}
    </Link>
  ) : (
    <div className={frame} data-testid={`module-home-screen-${screen.id}`}>
      {body}
    </div>
  );
}

/** A screen's first values, label beside value; nothing when its file is not known here. */
function ScreenValues({ project, screen }: { project: Project; screen: ServerEditorScreen }) {
  const { t } = useTranslation();
  const { lines, rows } = screenPreview(project, screen);
  if (rows != null)
    return (
      <p className="text-[12px] text-[var(--text-mut)]">{t("moduleHome.rows", { count: rows })}</p>
    );
  if (lines.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-[12px]">
      {lines.map((line) => (
        <div key={line.label} className="contents">
          <dt className="truncate text-[var(--text-mut)]" title={line.label}>
            {line.label}
          </dt>
          <dd className="max-w-40 truncate text-right font-mono tabular-nums text-[var(--text)]">
            {valueText(line, t)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function valueText(line: PreviewLine, t: (key: string) => string): string {
  if (typeof line.value === "boolean") return line.value ? t("moduleHome.on") : t("moduleHome.off");
  return String(line.value);
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
