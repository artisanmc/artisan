import type { MenuId, ProjectId } from "@/domain/types";
import type { ArrangeMode } from "@/features/canvas/arrangeBoard";
import type { ViewportState } from "@/features/canvas/usePanZoom";
import { type SupportedLang, detectEditorLang } from "@/i18n";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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

export interface CenterRequest {
  projectId: string;
  docId: string;
  nonce: number;
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
  /**
   * The edit panel is the selection's inspector: it only exists when there is
   * something to inspect. The PROJECT settings match no selection — this flag
   * is the "nothing selected, but show me the project anyway" set by the tree
   * root. Ephemeral: never persisted.
   */
  projectSettingsOpen: boolean;
  setProjectSettingsOpen: (open: boolean) => void;
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
  setMenuPreviewArgs: (menuId: string, args: Record<string, unknown>) => void;
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
   * v3 title composer — invoke AFTER `projectsStore.removeMenuTitleLayer` to
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
   * v3 title composer — invoke AFTER `projectsStore.reorderMenuTitleLayers`
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
   * Cmd+K search palette open? Transient session state: deliberately NOT
   * persisted (see partialize).
   */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /** Canvas interaction mode: hand (pan, default) or select (click + marquee). Persisted. */
  canvasMode: "select" | "hand";
  setCanvasMode: (m: "select" | "hand") => void;
  /** Last rearrange mode chosen in the toolbar. Persisted. */
  arrangeMode: ArrangeMode;
  setArrangeMode: (m: ArrangeMode) => void;
  /**
   * Saved pan/zoom of the main board, keyed by projectId. Lets the user leave
   * the board (e.g. open a single element's view) and come back to exactly the
   * same place + zoom, including after a reload.
   */
  canvasViewports: Record<string, ViewportState>;
  minimapVisible: boolean;
  setMinimapVisible: (visible: boolean) => void;
  setCanvasViewport: (projectId: ProjectId, viewport: ViewportState) => void;
  /**
   * Pan/zoom of the single view, **shared by all documents** and persisted: the
   * framing follows the user from one menu to another, instead of resetting to
   * the default framing on every open.
   * `null` = never set, the view then fits the document.
   * `canvasViewports` keeps each project's framing separately.
   */
  documentViewport: ViewportState | null;
  setDocumentViewport: (viewport: ViewportState | null) => void;
  /**
   * "Center the board on this Document" (`goToDocument`). Ephemeral, never
   * persisted; the `nonce` makes a second click on the same Document re-center.
   * The project's board consumes it as soon as it can respond.
   */
  centerRequest: CenterRequest | null;
  requestCenter: (projectId: string, docId: string) => void;
  clearCenterRequest: (nonce: number) => void;
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
        // Sync to the player's profile if logged-in. Fire-and-forget — UI doesn't block.
        // Dynamic imports avoid module-load-time circular deps with authStore.
        import("./authStore").then(({ useAuthStore }) => {
          const user = useAuthStore.getState().currentUser;
          if (!user) return;
          import("@/lib/api/auth").then(({ patchMe }) =>
            patchMe({ editor_language: lang }).catch(() => {
              console.warn("editor_language sync to backend failed (offline?)");
            }),
          );
        });
      },
      flowCanvasHeight: 280,
      setFlowCanvasHeight: (h) => set({ flowCanvasHeight: h }),
      editorPaneWidth: 420,
      setEditorPaneWidth: (w) => set({ editorPaneWidth: w }),
      projectSettingsOpen: false,
      setProjectSettingsOpen: (open) => set({ projectSettingsOpen: open }),
      armedMaterial: null,
      setArmedMaterial: (m) => set({ armedMaterial: m }),
      menuPreviewArgs: {},
      setMenuPreviewArgs: (menuId, args) =>
        set((s) => ({
          menuPreviewArgs: {
            ...s.menuPreviewArgs,
            [menuId]: { ...(s.menuPreviewArgs[menuId] ?? {}), ...args },
          },
        })),
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
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),
      canvasMode: "hand",
      setCanvasMode: (m) => set({ canvasMode: m }),
      arrangeMode: "columns",
      setArrangeMode: (m) => set({ arrangeMode: m }),
      canvasViewports: {},
      minimapVisible: true,
      setMinimapVisible: (minimapVisible) => set({ minimapVisible }),
      documentViewport: null,
      setDocumentViewport: (viewport) => set({ documentViewport: viewport }),
      centerRequest: null,
      requestCenter: (projectId, docId) =>
        set((s) => ({
          centerRequest: { projectId, docId, nonce: (s.centerRequest?.nonce ?? 0) + 1 },
        })),
      clearCenterRequest: (nonce) =>
        set((s) => (s.centerRequest?.nonce === nonce ? { centerRequest: null } : {})),
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
        // Drop the key (not set undefined) so merge's {...current, ...p} keeps the
        // new default rather than spreading an explicit undefined over it.
        if (version < 1) {
          const { canvasMode: _dropped, ...rest } = p;
          return rest as UiState;
        }
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
        canvasMode: state.canvasMode,
        arrangeMode: state.arrangeMode,
        canvasViewports: state.canvasViewports,
        minimapVisible: state.minimapVisible,
        // Persisted: the single view's framing follows the user, page to page and
        // after a reload.
        documentViewport: state.documentViewport,
      }),
      // Discard retired inspector tabs and the retired assistant pane width,
      // and restore the editor language.
      merge: (persisted, current) => {
        const {
          editorTab: _editorTab,
          assistantPaneWidth: _assistantPaneWidth,
          ...p
        } = (persisted ?? {}) as Partial<UiState> & {
          editorTab?: unknown;
          assistantPaneWidth?: unknown;
        };
        if (p.editorLang) {
          import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(p.editorLang));
        }
        return { ...current, ...p };
      },
    },
  ),
);
