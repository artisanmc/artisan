import { assetPreviewUrl } from "@/domain/asset";
import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { type DocKey, allDocuments, docKey } from "@/domain/documents";
import type { I18nKey, Project, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAssetSize } from "@/features/assets/measuredSize";
import { getText, newI18nKey } from "@/lib/i18n";
import { mcLineWidth, wrapLore } from "@/lib/loreWrap";
import { projectDestination } from "@/lib/projectNavigation";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import { fieldTextOf } from "@/schema/fieldText";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { type EditorHost, type HostComponents, installEditorHost } from "@artisan/editor-sdk";
import { useNavigate, useParams } from "@tanstack/react-router";
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
    const asset = useAssetStore((s) =>
      s.assets.find((a) => a.projectId === projectId && (a.name === name || a.id === name)),
    );
    const url = useAuthenticatedImageUrl(asset ? assetPreviewUrl(asset) : "");
    // A module's image has no descriptor: 0 × 0 until its size is read from the image.
    const size = useAssetSize(asset, url);
    return asset && url
      ? { url, width: size?.width ?? asset.width, height: size?.height ?? asset.height }
      : undefined;
  },
  mcTextWidth: (source) => mcLineWidth(source),
  mcWrap: (source, width) => wrapLore(source, width),
};

/** `components`: the editor widgets module views embed (`distribution/hostComponents.tsx`). */
export function installHost(components: HostComponents): void {
  installEditorHost({ ...editorHost, components });
}
