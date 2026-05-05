import type { PackId } from "@/domain/types";
import { type SupportedLang, detectEditorLang } from "@/i18n";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EditorTab = "edit" | "library";

/**
 * Best-effort detection of the user's preferred language from the
 * browser. Returns just the primary subtag (e.g. "en" from "en-US")
 * because pack lang codes are short. Falls back to "en" off-platform.
 */
function detectInitialLang(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language.slice(0, 2).toLowerCase();
  }
  return "en";
}

interface UiState {
  /** Last pack the user opened. The index route reads this to redirect. */
  lastActivePackId: PackId | null;
  setLastActivePackId: (id: PackId | null) => void;
  /**
   * Currently displayed/edited language across the editor — drives
   * `getText` resolution in canvas/tooltips and `setI18nValue` writes
   * from text inputs. Persisted so a user's preferred lang sticks
   * across reloads. Defaults to the browser's primary language tag.
   */
  activeLang: string;
  setActiveLang: (lang: string) => void;
  /**
   * Display language of the editor itself (UI labels, buttons, error
   * messages). Distinct from `activeLang`: a French user translating
   * their pack into English keeps the editor in French. The setter
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
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lastActivePackId: null,
      setLastActivePackId: (id) => set({ lastActivePackId: id }),
      activeLang: detectInitialLang(),
      setActiveLang: (lang) => set({ activeLang: lang }),
      editorLang: detectEditorLang(),
      setEditorLang: (lang) => {
        set({ editorLang: lang });
        // Sync the i18next instance lazily — importing here keeps the
        // store free of a hard dep on the i18n module at module load.
        import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(lang));
      },
      flowCanvasHeight: 280,
      setFlowCanvasHeight: (h) => set({ flowCanvasHeight: h }),
      editorPaneWidth: 420,
      setEditorPaneWidth: (w) => set({ editorPaneWidth: w }),
      editorTab: "edit",
      setEditorTab: (t) => set({ editorTab: t }),
      armedMaterial: null,
      setArmedMaterial: (m) => set({ armedMaterial: m }),
    }),
    {
      name: "interfaze:ui",
      // armedMaterial is session state; don't persist it.
      partialize: (state) => ({
        lastActivePackId: state.lastActivePackId,
        activeLang: state.activeLang,
        editorLang: state.editorLang,
        flowCanvasHeight: state.flowCanvasHeight,
        editorPaneWidth: state.editorPaneWidth,
        editorTab: state.editorTab,
      }),
      // Coerce legacy persisted tab values ("code", "props") to "edit" — the
      // 3-tab structure was replaced by 2 tabs (Edit + Library). Also push
      // the persisted editor language into i18next so the very first paint
      // uses the right locale (avoids an EN flash when the user is on FR).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        const t: EditorTab = p.editorTab === "library" ? "library" : "edit";
        if (p.editorLang) {
          import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(p.editorLang));
        }
        return { ...current, ...p, editorTab: t };
      },
    },
  ),
);
