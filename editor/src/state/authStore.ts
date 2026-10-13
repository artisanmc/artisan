import type { Account } from "@/domain/types";
import type { AuthUserDto } from "@/lib/api/auth";
import { AuthUnreachableError, logout as apiLogout, getMe } from "@/lib/api/auth";
import { create } from "zustand";
import { useProjectCacheStore } from "./projectCacheStore";
import { useProjectDraftStore } from "./projectDraftStore";
import { useProjectRuntimeStore } from "./projectRuntimeStore";

/** Ce qu'on sait de la session — « unknown » tant que le serveur n'a pas répondu. */
export type SessionStatus = "unknown" | "signed-out" | "signed-in";

interface AuthState {
  currentUser: AuthUserDto | null;
  isLoading: boolean;
  sessionStatus: SessionStatus;
  error: string | null;
  hydrate: (apiUrl: string) => Promise<void>;
  logout: (apiUrl: string) => Promise<void>;
}

/** Attentes entre deux `/me` tant que le backend est injoignable, puis palier. */
const AUTH_RETRY_DELAYS = [1_000, 3_000, 6_000, 10_000];

/**
 * Attend que l'onglet redevienne visible.
 *
 * Un onglet caché n'a personne devant lui : continuer à interroger un backend
 * qui redémarre, depuis chaque onglet ouvert, n'avance rien. Le retour de
 * l'onglet est de toute façon le moment où la réponse commence à compter.
 */
function whenVisible(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

/** Deux `hydrate()` concurrents (remontage, reconnexion manuelle) : seule la
 *  plus récente a le droit de conclure, sinon deux boucles de réessai se
 *  marchent dessus. */
let hydrateGeneration = 0;

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  // Start true: hydrate() has not yet run on first render. Routes that gate on
  // auth state must wait for isLoading to flip to false before deciding to
  // redirect, otherwise they race the hydration fetch and incorrectly send
  // logged-in users to /login.
  isLoading: true,
  sessionStatus: "unknown",
  error: null,
  async hydrate(apiUrl) {
    const generation = ++hydrateGeneration;
    set({ isLoading: true });
    // Un serveur injoignable (redémarrage, coupure réseau) ne dit pas « déconnecté » :
    // la session reste « unknown » et on réessaye jusqu'à savoir.
    let user: AuthUserDto | null = null;
    for (let attempt = 0; ; attempt++) {
      if (generation !== hydrateGeneration) return;
      try {
        user = await getMe({ apiUrl });
        break;
      } catch (e) {
        if (!(e instanceof AuthUnreachableError)) throw e;
        // Un utilisateur déjà connu le reste : lui, l'app peut le servir.
        set((s) => ({
          error: "auth_unreachable",
          isLoading: s.currentUser === null ? s.isLoading : false,
        }));
        const delay = AUTH_RETRY_DELAYS[Math.min(attempt, AUTH_RETRY_DELAYS.length - 1)]!;
        await new Promise((r) => setTimeout(r, delay));
        await whenVisible();
      }
    }
    if (generation !== hydrateGeneration) return;
    set({
      currentUser: user,
      sessionStatus: user ? "signed-in" : "signed-out",
      isLoading: false,
      error: null,
    });
    if (user?.editorLanguage) {
      const { default: i18n } = await import("@/i18n");
      await i18n.changeLanguage(user.editorLanguage);
    }
    // Apply server-side theme preference only if the user hasn't made a
    // local choice yet. localStorage wins (checked by detectInitialTheme).
    if (user?.theme) {
      const hasLocalChoice = (() => {
        try {
          const raw = localStorage.getItem("artisan.theme");
          if (!raw) return false;
          const parsed = JSON.parse(raw) as { state?: { theme?: string } };
          return parsed?.state?.theme === "dark" || parsed?.state?.theme === "light";
        } catch {
          return false;
        }
      })();
      if (!hasLocalChoice) {
        const { useThemeStore } = await import("./themeStore");
        useThemeStore.getState().setTheme(user.theme as "dark" | "light");
      }
    }
  },
  async logout(apiUrl) {
    await apiLogout({ apiUrl });
    set({
      currentUser: null,
      sessionStatus: "signed-out",
      error: null,
    });
  },
}));

// Account-scoped local state must not leak across identities. Without this,
// switching accounts in the same tab keeps the previous account's projects in
// the sidebar, and clicking one navigates into a network the new user can't
// access (403 → bounced to /networks). We clear:
//   - accountStore (in-memory projects of the previous account)
//   - uiStore last-active pointers (persisted; used by restore flows)
// Deliberately NOT cleared on first sign-in (null → user): a page load may
// have already populated accountStore (e.g. from a prior fetch in flight),
// and that state must survive.
let lastSeenUserId: string | null | undefined;
useAuthStore.subscribe(async (state) => {
  const id = state.currentUser?.id ?? null;
  if (lastSeenUserId === undefined) {
    lastSeenUserId = id;
    return;
  }
  if (id === lastSeenUserId) return;
  const previous = lastSeenUserId;
  lastSeenUserId = id;
  if (previous === null) return; // first sign-in — keep prior state
  useProjectDraftStore.getState().setOwner(id);
  useProjectRuntimeStore.getState().set(null);
  useProjectCacheStore.setState({ entries: {} });
  // Dynamic imports to avoid store import cycles (same pattern as hydrate()).
  const [{ useAccountStore }, { useUiStore }] = await Promise.all([
    import("./accountStore"),
    import("./uiStore"),
  ]);
  const emptyAccount: Account = { id: "" as Account["id"], projects: [], projectOrder: [] };
  useAccountStore.getState().setAccount(emptyAccount);
  useUiStore.getState().setLastActiveProjectId(null);
});
