import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (next: Theme) => void;
}

/**
 * Reads the initial theme from localStorage (via zustand persist), falling
 * back to OS preference. Called once at module load — before React mount —
 * so main.tsx can apply <html data-theme> without FOUC.
 */
export function detectInitialTheme(): Theme {
  // zustand persist stores as JSON string: '"dark"' or '"light"'
  try {
    const raw = localStorage.getItem("artisan.theme");
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { theme?: string } };
      if (parsed?.state?.theme === "dark" || parsed?.state?.theme === "light") {
        return parsed.state.theme;
      }
    }
  } catch {
    // localStorage unavailable or malformed — fall through
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: detectInitialTheme(),
      setTheme: (next: Theme) => {
        document.documentElement.dataset.theme = next;
        set({ theme: next });
        // Fire-and-forget sync to the account — same pattern as editor_language in uiStore.
        import("./authStore").then(({ useAuthStore }) => {
          const user = useAuthStore.getState().currentUser;
          if (!user) return;
          import("@/lib/api/auth").then(({ patchMe }) =>
            patchMe({ theme: next }).catch(() => {
              console.warn("theme sync to backend failed (offline?)");
            }),
          );
        });
      },
    }),
    {
      name: "artisan.theme",
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);
