import type { MenuId, ProjectId } from "@/domain/types";
import type { ViewportState } from "@/features/canvas/usePanZoom";
import { type SupportedLang, detectEditorLang } from "@/i18n";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// "sets" was briefly a top-level tab (2026-07-17) — now a Library sub-tab; the
// persist merge below coerces any unknown persisted value back to "edit".
export type EditorTab = "edit" | "library" | "assets";

/**
 * Best-effort detection of the user's preferred language from the
 * browser. Returns just the primary subtag (e.g. "en" from "en-US")
 * because project lang codes are short. Falls back to "en" off-platform.
 */
function detectInitialLang(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language.slice(0, 2).toLowerCase();
  }
  return "en";
}

/** v3 title composer — currently-selected layer inside a menu's title. */
export interface SelectedLayerKey {
  menuId: MenuId;
  index: number;
}

/** v3 title composer — ghost state for the "drag-to-attach" gesture from + Image / + Text / + Bloc texte buttons. */
export interface DraggingNewLayer {
  kind: "image" | "text" | "textarea";
  /** Pointer position in screen coords (px); consumers convert as needed. */
  x: number;
  y: number;
}

interface UiState {
  /** Last project the user opened. The index route reads this to redirect. */
  lastActiveProjectId: ProjectId | null;
  setLastActiveProjectId: (id: ProjectId | null) => void;
  /**
   * Last workspace tab the user viewed (overview / translations /
   * data-sources / history). Persisted so a page reload — which bounces
   * through /session — can return to the same tab, not just the same project.
   */
  lastActiveTab: string | null;
  setLastActiveTab: (tab: string | null) => void;
  /**
   * Currently displayed/edited language across the editor — drives
   * `getText` resolution in canvas/tooltips and `setI18nValue` writes
   * from text inputs. Persisted so a user's preferred lang sticks
   * across reloads. Defaults to the browser's primary language tag.
   */
  activeLang: string;
  setActiveLang: (lang: string) => void;
  /**
   * Whose eyes the canvas previews through. Data sources are fetched with
   * `player = null` by default, so a per-player source (quests, homes, balance)
   * has nothing to show; naming an online player makes the preview fetch as
   * them and the canvas render what they would actually see.
   *
   * Session-only on purpose — it is a debugging lens, not a project setting, and
   * it must not silently persist onto another server where the player is absent.
   */
  previewPlayer: string;
  setPreviewPlayer: (name: string) => void;
  /**
   * Display language of the editor itself (UI labels, buttons, error
   * messages). Distinct from `activeLang`: a French user translating
   * their project into English keeps the editor in French. The setter
   * also updates the i18next instance so visible text re-renders.
   */
  editorLang: SupportedLang;
  setEditorLang: (lang: SupportedLang) => void;
  /** Height (px) of the editor pane when laid out at the bottom (mobile). */
  flowCanvasHeight: number;
  setFlowCanvasHeight: (h: number) => void;
  /** Width (px) of the editor pane when laid out as a right sidebar (desktop). */
  editorPaneWidth: number;
  setEditorPaneWidth: (w: number) => void;
  /** Active tab inside the editor pane. */
  editorTab: EditorTab;
  setEditorTab: (t: EditorTab) => void;
  /**
   * Material name currently "armed" from the Library — the next slot tap
   * places it. Touch fallback when drag-and-drop isn't practical.
   */
  armedMaterial: string | null;
  setArmedMaterial: (m: string | null) => void;
  /**
   * Preview context for parameterized menus (canvas "preview as…" selector):
   * menuId → { argName: value }. Feeds primitive contextInput values and the
   * `{arg}` tokens in source filters when the canvas builds its preview
   * scope. Session state — not persisted.
   */
  menuPreviewArgs: Record<string, Record<string, unknown>>;
  setMenuPreviewArg: (menuId: string, arg: string, value: unknown) => void;
  activeDragMaterial: string | null;
  setActiveDragMaterial: (m: string | null) => void;
  /**
   * Placement-mode row "armed" from the row palette — the next slot tap on the
   * matching menu pins it at the current page. Touch fallback for the drag path.
   */
  armedPlacement: { menuId: string; elementId: string; key: string } | null;
  setArmedPlacement: (p: { menuId: string; elementId: string; key: string } | null) => void;
  /**
   * v3 title composer — id of the menu currently selected in the project canvas.
   * Drives the contents of the 3rd-column LayersPanel. Distinct from the
   * `lastSelectedMenuId` "sticky" mirror below.
   */
  selectedMenuId: MenuId | null;
  /**
   * v3 title composer — sticky reference to the most recently selected menu.
   * Survives when `selectedMenuId` goes null (e.g. user clicks empty space on
   * the canvas) so the LayersPanel can keep showing the last menu's layers.
   * Kept in sync automatically by `setSelectedMenuId`.
   */
  lastSelectedMenuId: MenuId | null;
  setSelectedMenuId: (id: MenuId | null) => void;
  setLastSelectedMenuId: (id: MenuId | null) => void;
  /**
   * v3 title composer — currently-selected layer inside a menu's title.
   * Set by canvas clicks and panel clicks. Null = no layer selected.
   */
  selectedLayerKey: SelectedLayerKey | null;
  setSelectedLayerKey: (key: SelectedLayerKey | null) => void;
  /**
   * v3 title composer — ephemeral "hide-this-layer" flags. Keys formatted
   * as `${menuId}:${index}`. Pure UI state, not persisted, not exported.
   */
  hiddenLayerKeys: Set<string>;
  toggleHiddenLayer: (menuId: MenuId, index: number) => void;
  clearHiddenLayers: () => void;
  /**
   * v3 title composer — invoke AFTER `accountStore.removeMenuTitleLayer` to
   * keep UI state in sync with the new layer indices. Without this, a stale
   * `selectedLayerKey` would point at the shifted-up neighbour (or nothing),
   * and `hiddenLayerKeys` would still flag indices that no longer exist.
   *
   * Behaviour:
   *  - If `selectedLayerKey === {menuId, index: deletedIndex}` → cleared.
   *  - If `selectedLayerKey.menuId === menuId && selectedLayerKey.index > deletedIndex` → decremented by 1.
   *  - Hidden entries for `(menuId, deletedIndex)` are dropped; entries with `index > deletedIndex` shift down by 1.
   *  - Entries from other menus are untouched.
   */
  applyLayerDeleted: (menuId: MenuId, deletedIndex: number) => void;
  /**
   * v3 title composer — invoke AFTER `accountStore.reorderMenuTitleLayers`
   * to remap `selectedLayerKey` and `hiddenLayerKeys` indices to match the
   * post-move ordering. Mirrors the splice semantics: pull element out at
   * `fromIndex`, insert at `toIndex`. Entries in other menus are untouched.
   */
  applyLayerMoved: (menuId: MenuId, fromIndex: number, toIndex: number) => void;
  /**
   * v3 title composer — ghost state during the "drag-to-attach" gesture
   * from + Image / + Text buttons in the LayersPanel. Null when no drag
   * is in flight.
   */
  draggingNewLayer: DraggingNewLayer | null;
  setDraggingNewLayer: (payload: DraggingNewLayer | null) => void;
  /**
   * Left workspace panel (ProjectPanel) visible? Persisted — the user's
   * choice survives reloads.
   */
  projectPanelOpen: boolean;
  setProjectPanelOpen: (open: boolean) => void;
  toggleProjectPanel: () => void;
  /**
   * Cmd+K search palette open? Transient session state: deliberately NOT
   * persisted (see partialize).
   */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /**
   * AI assistant overlay — whether the right-side chat Sheet is open.
   * Transient session state: deliberately NOT persisted (see partialize).
   */
  assistantPanelOpen: boolean;
  setAssistantPanelOpen: (open: boolean) => void;
  /** Width (px) of the AI assistant pane when docked on the right (desktop). */
  assistantPaneWidth: number;
  setAssistantPaneWidth: (w: number) => void;
  /** Mode d'interaction du canvas : main (pan, défaut) ou sélection (clic + marquee). Persisté. */
  canvasMode: "select" | "hand";
  setCanvasMode: (m: "select" | "hand") => void;
  /**
   * Pan/zoom sauvegardé de la planche principale, indexé par projectId. Permet de
   * quitter la planche (ex. ouvrir la vue d'un élément unique) puis d'y revenir
   * exactement au même endroit + zoom. Session-only : volontairement NON persisté
   * (un reload repart de la vue centrée par défaut).
   */
  canvasViewports: Record<string, ViewportState>;
  setCanvasViewport: (projectId: ProjectId, viewport: ViewportState) => void;
  /**
   * Pan/zoom de la vue individuelle, **partagé par tous les documents** et
   * persisté : le cadrage suit l'utilisateur quand il passe d'un menu à un
   * autre, au lieu de repartir du cadrage par défaut à chaque ouverture.
   * `null` = jamais réglé, la vue s'ajuste alors au document.
   * (`canvasViewports`, la planche, reste par project et session-only.)
   */
  documentViewport: ViewportState | null;
  setDocumentViewport: (viewport: ViewportState | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lastActiveProjectId: null,
      setLastActiveProjectId: (id) => set({ lastActiveProjectId: id }),
      lastActiveTab: null,
      setLastActiveTab: (tab) => set({ lastActiveTab: tab }),
      activeLang: detectInitialLang(),
      setActiveLang: (lang) => set({ activeLang: lang }),
      previewPlayer: "",
      setPreviewPlayer: (name) => set({ previewPlayer: name }),
      editorLang: detectEditorLang(),
      setEditorLang: (lang) => {
        set({ editorLang: lang });
        // Sync the i18next instance lazily — importing here keeps the
        // store free of a hard dep on the i18n module at module load.
        import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(lang));
        // Sync to backend if logged-in. Fire-and-forget — UI doesn't block.
        // Dynamic imports avoid module-load-time circular deps with authStore.
        import("./authStore").then(({ useAuthStore }) => {
          const user = useAuthStore.getState().currentUser;
          if (!user) return;
          const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
          import("@/lib/api/auth").then(({ patchMe }) =>
            patchMe({ apiUrl }, { editor_language: lang }).catch(() => {
              console.warn("editor_language sync to backend failed (offline?)");
            }),
          );
        });
      },
      flowCanvasHeight: 280,
      setFlowCanvasHeight: (h) => set({ flowCanvasHeight: h }),
      editorPaneWidth: 420,
      setEditorPaneWidth: (w) => set({ editorPaneWidth: w }),
      editorTab: "edit",
      setEditorTab: (t) => set({ editorTab: t }),
      armedMaterial: null,
      setArmedMaterial: (m) => set({ armedMaterial: m }),
      menuPreviewArgs: {},
      setMenuPreviewArg: (menuId, arg, value) =>
        set((s) => ({
          menuPreviewArgs: {
            ...s.menuPreviewArgs,
            [menuId]: { ...(s.menuPreviewArgs[menuId] ?? {}), [arg]: value },
          },
        })),
      armedPlacement: null,
      setArmedPlacement: (p) => set({ armedPlacement: p }),
      activeDragMaterial: null,
      setActiveDragMaterial: (m) => set({ activeDragMaterial: m }),
      selectedMenuId: null,
      lastSelectedMenuId: null,
      setSelectedMenuId: (id) =>
        set((s) => ({
          selectedMenuId: id,
          // Sticky: only refresh lastSelectedMenuId when a real id arrives;
          // when id is null, preserve the previous lastSelectedMenuId so the
          // LayersPanel can keep showing the most recent menu.
          lastSelectedMenuId: id ?? s.lastSelectedMenuId,
        })),
      setLastSelectedMenuId: (id) => set({ lastSelectedMenuId: id }),
      selectedLayerKey: null,
      setSelectedLayerKey: (key) => set({ selectedLayerKey: key }),
      hiddenLayerKeys: new Set<string>(),
      toggleHiddenLayer: (menuId, index) =>
        set((s) => {
          const key = `${menuId}:${index}`;
          const next = new Set(s.hiddenLayerKeys);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return { hiddenLayerKeys: next };
        }),
      clearHiddenLayers: () => set({ hiddenLayerKeys: new Set<string>() }),
      applyLayerDeleted: (menuId, deletedIndex) =>
        set((s) => {
          // selectedLayerKey: clear if it pointed at the deleted layer, or
          // shift down by 1 if it pointed past it.
          let nextSelected = s.selectedLayerKey;
          if (nextSelected && nextSelected.menuId === menuId) {
            if (nextSelected.index === deletedIndex) {
              nextSelected = null;
            } else if (nextSelected.index > deletedIndex) {
              nextSelected = { menuId, index: nextSelected.index - 1 };
            }
          }
          // hiddenLayerKeys: drop the deleted index and shift higher indices
          // down by 1. Iterate keys, parse `${menuId}:${index}`, rewrite.
          const nextHidden = new Set<string>();
          for (const key of s.hiddenLayerKeys) {
            const sep = key.lastIndexOf(":");
            if (sep < 0) {
              nextHidden.add(key);
              continue;
            }
            const k = key.slice(0, sep) as MenuId;
            const i = Number(key.slice(sep + 1));
            if (k !== menuId || !Number.isFinite(i)) {
              nextHidden.add(key);
              continue;
            }
            if (i === deletedIndex) continue; // dropped
            if (i > deletedIndex) {
              nextHidden.add(`${k}:${i - 1}`);
            } else {
              nextHidden.add(key);
            }
          }
          return { selectedLayerKey: nextSelected, hiddenLayerKeys: nextHidden };
        }),
      applyLayerMoved: (menuId, fromIndex, toIndex) =>
        set((s) => {
          const remap = (i: number): number => {
            if (i === fromIndex) return toIndex;
            // Element moves up the list (smaller → larger): indices in
            // (fromIndex, toIndex] shift down by 1 to fill the gap.
            if (fromIndex < toIndex && i > fromIndex && i <= toIndex) return i - 1;
            // Element moves down the list (larger → smaller): indices in
            // [toIndex, fromIndex) shift up by 1 to make room.
            if (toIndex < fromIndex && i >= toIndex && i < fromIndex) return i + 1;
            return i;
          };

          let nextSelected = s.selectedLayerKey;
          if (nextSelected && nextSelected.menuId === menuId) {
            const newIndex = remap(nextSelected.index);
            if (newIndex !== nextSelected.index) {
              nextSelected = { menuId, index: newIndex };
            }
          }

          const nextHidden = new Set<string>();
          for (const key of s.hiddenLayerKeys) {
            const sep = key.lastIndexOf(":");
            if (sep < 0) {
              nextHidden.add(key);
              continue;
            }
            const k = key.slice(0, sep) as MenuId;
            const i = Number(key.slice(sep + 1));
            if (k !== menuId || !Number.isFinite(i)) {
              nextHidden.add(key);
              continue;
            }
            nextHidden.add(`${k}:${remap(i)}`);
          }
          return { selectedLayerKey: nextSelected, hiddenLayerKeys: nextHidden };
        }),
      draggingNewLayer: null,
      setDraggingNewLayer: (payload) => set({ draggingNewLayer: payload }),
      projectPanelOpen: true,
      setProjectPanelOpen: (open) => set({ projectPanelOpen: open }),
      toggleProjectPanel: () => set((s) => ({ projectPanelOpen: !s.projectPanelOpen })),
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),
      assistantPanelOpen: false,
      setAssistantPanelOpen: (open) => set({ assistantPanelOpen: open }),
      assistantPaneWidth: 380,
      setAssistantPaneWidth: (w) => set({ assistantPaneWidth: w }),
      canvasMode: "hand",
      setCanvasMode: (m) => set({ canvasMode: m }),
      canvasViewports: {},
      documentViewport: null,
      setDocumentViewport: (viewport) => set({ documentViewport: viewport }),
      setCanvasViewport: (projectId, viewport) =>
        set((s) => ({ canvasViewports: { ...s.canvasViewports, [projectId]: viewport } })),
    }),
    {
      name: "artisan:ui",
      // Bump when a persisted default flips so existing users pick it up once.
      // v1: canvasMode default changed select → hand; drop the old persisted
      // value so the new default applies (then future toggles persist again).
      version: 1,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        // delete (not set undefined) so merge's {...current, ...p} keeps the
        // new default rather than spreading an explicit undefined over it.
        if (version < 1) delete p.canvasMode;
        return p as UiState;
      },
      // armedMaterial is session state; don't persist it.
      // Title-composer v3 fields (selectedLayerKey, hiddenLayerKeys,
      // draggingNewLayer, selectedMenuId, lastSelectedMenuId) are all
      // ephemeral UI state; never persisted.
      partialize: (state) => ({
        lastActiveProjectId: state.lastActiveProjectId,
        lastActiveTab: state.lastActiveTab,
        activeLang: state.activeLang,
        editorLang: state.editorLang,
        flowCanvasHeight: state.flowCanvasHeight,
        editorPaneWidth: state.editorPaneWidth,
        assistantPaneWidth: state.assistantPaneWidth,
        editorTab: state.editorTab,
        projectPanelOpen: state.projectPanelOpen,
        canvasMode: state.canvasMode,
        // Persisté (contrairement à canvasViewports) : le cadrage de la vue
        // individuelle suit l'utilisateur, page à page et après rechargement.
        documentViewport: state.documentViewport,
      }),
      // Coerce legacy persisted tab values ("code", "props") to "edit" — the
      // 3-tab structure was replaced by 2 tabs (Edit + Library). Also push
      // the persisted editor language into i18next so the very first paint
      // uses the right locale (avoids an EN flash when the user is on FR).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        const t: EditorTab =
          p.editorTab === "library" ? "library" : p.editorTab === "assets" ? "assets" : "edit";
        if (p.editorLang) {
          import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(p.editorLang));
        }
        return { ...current, ...p, editorTab: t };
      },
    },
  ),
);
