import type { Account } from "@/domain/types";
import type { AuthUserDto } from "@/lib/api/auth";
import {
  AuthUnreachableError,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  getMe,
} from "@/lib/api/auth";
import { create } from "zustand";

/** Ce qu'on sait de la session — « unknown » tant que le backend n'a pas
 *  répondu. Il n'y a pas de mode anonyme : « signed-out » veut dire /login. */
export type SessionStatus = "unknown" | "signed-out" | "signed-in";

interface AuthState {
  currentUser: AuthUserDto | null;
  isLoading: boolean;
  sessionStatus: SessionStatus;
  /** Le dernier `/me` n'a pas abouti — l'app réessaye en arrière-plan. */
  backendUnreachable: boolean;
  error: string | null;
  hydrate: (apiUrl: string) => Promise<void>;
  login: (
    apiUrl: string,
    payload: { email: string; password: string },
  ) => Promise<{ ok: true } | { ok: false; error: string; status: number }>;
  signup: (
    apiUrl: string,
    payload: { email: string; password: string; name: string },
  ) => Promise<{ ok: true } | { ok: false; error: string; status: number }>;
  logout: (apiUrl: string) => Promise<void>;
}

/** Attentes entre deux `/me` tant que le backend est injoignable, puis palier. */
const AUTH_RETRY_DELAYS = [1_000, 3_000, 6_000, 10_000];

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
  backendUnreachable: false,
  error: null,
  async hydrate(apiUrl) {
    const generation = ++hydrateGeneration;
    set({ isLoading: true });
    /*
     * Le mode anonyme n'existe plus (accounts-only) : soit on sait qui tu es,
     * soit tu vas sur /login. Un backend injoignable (502, cold start, coupure
     * réseau) n'autorise donc aucune de ces deux réponses — et surtout pas
     * « déconnecté », qui envoyait sur un /login incapable de fonctionner
     * puisque c'est le même backend qui l'anime. La session reste « unknown »
     * et on réessaye jusqu'à savoir : l'app affiche le vrai problème (backend
     * injoignable) au lieu d'en inventer un autre.
     */
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
          backendUnreachable: true,
          error: "auth_unreachable",
          isLoading: s.currentUser === null ? s.isLoading : false,
        }));
        const delay = AUTH_RETRY_DELAYS[Math.min(attempt, AUTH_RETRY_DELAYS.length - 1)]!;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (generation !== hydrateGeneration) return;
    set({
      currentUser: user,
      sessionStatus: user ? "signed-in" : "signed-out",
      backendUnreachable: false,
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
  async login(apiUrl, payload) {
    set({ isLoading: true, error: null });
    const result = await apiLogin({ apiUrl }, payload);
    if (result.ok) {
      set({ currentUser: result.data.user, sessionStatus: "signed-in", isLoading: false });
      return { ok: true };
    }
    set({ error: result.error, isLoading: false });
    return { ok: false, error: result.error, status: result.status };
  },
  async signup(apiUrl, payload) {
    set({ isLoading: true, error: null });
    const result = await apiSignup({ apiUrl }, payload);
    if (result.ok) {
      set({ currentUser: result.data.user, sessionStatus: "signed-in", isLoading: false });
      return { ok: true };
    }
    set({ error: result.error, isLoading: false });
    return { ok: false, error: result.error, status: result.status };
  },
  async logout(apiUrl) {
    await apiLogout({ apiUrl });
    set({ currentUser: null, sessionStatus: "signed-out", error: null });
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
  // Dynamic imports to avoid store import cycles (same pattern as hydrate()).
  const [{ useAccountStore }, { useUiStore }] = await Promise.all([
    import("./accountStore"),
    import("./uiStore"),
  ]);
  const emptyAccount: Account = { id: "" as Account["id"], projects: [], projectOrder: [] };
  useAccountStore.getState().setAccount(emptyAccount);
  useUiStore.getState().setLastActiveProjectId(null);
});
