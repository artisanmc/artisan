import { assetPreviewUrl } from "@/domain/asset";
import { capturedDisplay } from "@/domain/capturedItems";
import { projectNamespace } from "@/domain/docRef";
import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { type DocKey, allDocuments, docKey, documentsOf } from "@/domain/documents";
import type { I18nKey, Project, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useKitAssets } from "@/features/assets/kitAssets";
import { useAssetSize } from "@/features/assets/measuredSize";
import { useDrawnInOwnModule } from "@/features/assets/moduleDrawings";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";
import {
  fetchStatsActives,
  fetchStatsBreakdown,
  fetchStatsEvents,
  fetchStatsQuery,
  fetchStatsSeries,
} from "@/lib/api/stats";
import { getText, newI18nKey } from "@/lib/i18n";
import { mcLineWidth, wrapLore } from "@/lib/loreWrap";
import { projectDestination } from "@/lib/projectNavigation";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import { fieldTextOf } from "@/schema/fieldText";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { optionsOf, useServerOptionListsStore } from "@/state/serverOptionListsStore";
import { useUiStore } from "@/state/uiStore";
import { type EditorHost, type HostComponents, installEditorHost } from "@artisan/editor-sdk";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";

/** The project's languages: its default, then every other one a text holds. */
export function projectLanguages(project: Project): string[] {
  const langs = new Set<string>([project.defaultLang]);
  for (const entry of Object.values(project.i18nKeys)) {
    for (const lang of Object.keys(entry ?? {})) langs.add(lang);
  }
  return [...langs];
}

/**
 * The key of the module Document a view names by its id alone: the SDK passes no kind, and a
 * module's view only selects its own kind's Documents, so a module kind wins over a core one
 * sharing that id.
 */
function moduleDocumentKey(documentId: string): DocKey {
  for (const project of useProjectsStore.getState().openProjects.projects) {
    const found = allDocuments(project).filter((d) => d.doc.id === documentId);
    const own = found.find((d) => !CORE_KINDS.has(d.kind)) ?? found[0];
    if (own) return docKey(own.kind, own.doc.id);
  }
  return docKey("menu", documentId);
}

const CORE_KINDS = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));

/**
 * The editor as `@artisan/editor-sdk` exposes it to a module's views (ADR
 * `runtime-editor-modules`): the same stores the core views use, behind the SDK's
 * narrow contract, so a bundle never imports the editor's internals.
 */
export const editorHost: Omit<EditorHost, "components"> = {
  useProject: (projectId) =>
    useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId)),
  useContentLang: () => useUiStore((s) => s.activeLang),
  useUiLang: () => useUiStore((s) => s.editorLang),
  updateDocument: ({ projectId, kind, id, doc, texts }) =>
    useProjectsStore
      .getState()
      .updateDocument({ projectId: projectId as ProjectId, kind, id, doc, texts }),
  newTextKey: () => newI18nKey(),
  text: (project, key, lang) => getText(project as Project, { key: key as I18nKey }, lang),
  fieldText: (project, key) => fieldTextOf(project as Project)(key as I18nKey),
  textValues: (project, key) => {
    const entry = (project as Project).i18nKeys[key as I18nKey] ?? {};
    return Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) as Record<
      string,
      string
    >;
  },
  langs: (project) => projectLanguages(project as Project),
  // A part is selected like a menu's element: its id, scoped by its Document's key.
  selectDocumentItem: ({ documentId, item }) =>
    item
      ? useSelectionStore.getState().set([item], null, moduleDocumentKey(documentId))
      : useSelectionStore.getState().set([moduleDocumentKey(documentId)]),
  useOpenDocument: () => {
    const navigate = useNavigate();
    const { serverId } = useParams({ strict: false }) as { serverId?: string };
    return ({ projectId, kind, id }) => {
      const project = useProjectsStore
        .getState()
        .openProjects.projects.find((p) => p.id === projectId);
      navigate(projectDestination(project ?? projectId, serverId, id, kind));
    };
  },
  notify: (message, tone) => (tone === "error" ? toast.error(message) : toast(message)),
  useAssetImage: (projectId, name) => {
    const own = useAssetStore((s) =>
      s.assets.find((a) => a.projectId === projectId && (a.name === name || a.id === name)),
    );
    // `kit:<name>`: the UI kit's image, which no module holds.
    const kit = useKitAssets().find((a) => a.id === name);
    // The module's own image as the themes in place show it, like the pack.
    const drawn = useDrawnInOwnModule(projectId);
    const asset = kit ?? (own && drawn(own));
    const url = useAuthenticatedImageUrl(asset ? assetPreviewUrl(asset) : "");
    // A module's image has no descriptor: 0 × 0 until its size is read from the image.
    const size = useAssetSize(asset, url);
    return asset && url
      ? { url, width: size?.width ?? asset.width, height: size?.height ?? asset.height }
      : undefined;
  },
  mcTextWidth: (source) => mcLineWidth(source),
  mcWrap: (source, width) => wrapLore(source, width),
  useItemTexture: (material) => {
    // A captured item (`item:<id>`) shows the item it was captured from, as the item fields do.
    const shown = useProjectsStore((s) => capturedDisplay(s.openProjects.projects, material));
    const [shownMaterial = material, head] = shown.split("\n");
    const texture = useTextureUrl(shownMaterial);
    return useHeadPreviewUrl(head || undefined) ?? texture;
  },
  useOptionList: (id) => {
    const lists = useServerOptionListsStore((s) => s.lists);
    const lang = useUiStore((s) => s.editorLang);
    return useMemo(() => optionsOf(lists, id, lang), [lists, id, lang]);
  },
  stats: {
    series: fetchStatsSeries,
    breakdown: fetchStatsBreakdown,
    actives: fetchStatsActives,
    events: fetchStatsEvents,
    query: fetchStatsQuery,
  },
  useServerDocuments: (kind) => {
    const open = useProjectsStore((s) => s.openProjects.projects);
    const published = sources.usePublishedProjects();
    return useMemo(() => serverDocuments(open, published, kind), [open, published, kind]);
  },
};

/**
 * A kind's Documents in every project of the server: the open projects' as edited, then the
 * published ones of the projects that are not open (the server index holds them all).
 */
export function serverDocuments(open: Project[], published: Project[], kind: string) {
  const edited = new Set(open.map(projectNamespace));
  return [...open, ...published.filter((p) => !edited.has(projectNamespace(p)))].flatMap(
    (project) =>
      documentsOf(project, kind).map((document) => ({
        projectId: project.id,
        namespace: projectNamespace(project),
        project,
        document,
      })),
  );
}

/** What the host reads from a feature, handed over by `main.tsx`: `lib` imports no feature. */
export interface HostSources {
  /** The server's published projects (the server index). A hook. */
  usePublishedProjects: () => Project[];
}

const NO_PROJECTS: Project[] = [];
let sources: HostSources = { usePublishedProjects: () => NO_PROJECTS };

/** `components`: the editor widgets module views embed (`distribution/hostComponents.tsx`). */
export function installHost(components: HostComponents, from?: HostSources): void {
  if (from) sources = from;
  installEditorHost({ ...editorHost, components });
}
