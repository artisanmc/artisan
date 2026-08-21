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

interface AuthState {
  currentUser: AuthUserDto | null;
  isLoading: boolean;
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

/** Réessais de `/me` avant de conclure quoi que ce soit sur la session. */
const AUTH_RETRY_DELAYS = [1_000, 3_000, 6_000];

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  // Start true: hydrate() has not yet run on first render. Routes that gate on
  // auth state must wait for isLoading to flip to false before deciding to
  // redirect, otherwise they race the hydration fetch and incorrectly send
  // logged-in users to /login.
  isLoading: true,
  error: null,
  async hydrate(apiUrl) {
    set({ isLoading: true });
    // Un backend injoignable (502, cold start, coupure réseau) ne dit RIEN de la
    // session : le prendre pour une déconnexion renvoyait sur /login un
    // utilisateur parfaitement connecté. On reste donc en chargement — donc
    // aucune route ne rebondit — et on réessaye. Après quoi seulement, backend
    // vraiment mort, on retombe sur « anonyme ».
    let user: AuthUserDto | null = null;
    let determined = false;
    for (let attempt = 0; attempt < AUTH_RETRY_DELAYS.length + 1; attempt++) {
      try {
        user = await getMe({ apiUrl });
        determined = true;
        break;
      } catch (e) {
        if (!(e instanceof AuthUnreachableError)) throw e;
        const delay = AUTH_RETRY_DELAYS[attempt];
        if (delay === undefined) break;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!determined) {
      // Session indéterminée : on ne fabrique pas de déconnexion, on garde
      // l'utilisateur déjà connu (s'il y en a un) et on rend la main.
      set({ isLoading: false, error: "auth_unreachable" });
      return;
    }
    set({ currentUser: user, isLoading: false, error: null });
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
      set({ currentUser: result.data.user, isLoading: false });
      return { ok: true };
    }
    set({ error: result.error, isLoading: false });
    return { ok: false, error: result.error, status: result.status };
  },
  async signup(apiUrl, payload) {
    set({ isLoading: true, error: null });
    const result = await apiSignup({ apiUrl }, payload);
    if (result.ok) {
      set({ currentUser: result.data.user, isLoading: false });
      return { ok: true };
    }
    set({ error: result.error, isLoading: false });
    return { ok: false, error: result.error, status: result.status };
  },
  async logout(apiUrl) {
    await apiLogout({ apiUrl });
    set({ currentUser: null, error: null });
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
