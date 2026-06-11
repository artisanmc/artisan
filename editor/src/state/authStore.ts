import type { Account } from "@/domain/types";
import type { AuthUserDto } from "@/lib/api/auth";
import { login as apiLogin, logout as apiLogout, signup as apiSignup, getMe } from "@/lib/api/auth";
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
    const user = await getMe({ apiUrl });
    set({ currentUser: user, isLoading: false });
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
// switching accounts in the same tab keeps the previous account's packs in
// the sidebar, and clicking one navigates into a network the new user can't
// access (403 → bounced to /networks). We clear:
//   - accountStore (in-memory packs of the previous account)
//   - uiStore last-active pointers (persisted; used by restore flows)
// Deliberately NOT cleared on first sign-in (null → user): the trust-dance
// session may have populated accountStore before the user signs up/logs in,
// and that state must survive (dual-auth flow).
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
  if (previous === null) return; // first sign-in — keep session-mode state
  // Dynamic imports to avoid store import cycles (same pattern as hydrate()).
  const [{ useAccountStore }, { useUiStore }, { useSessionStore }] = await Promise.all([
    import("./accountStore"),
    import("./uiStore"),
    import("./sessionStore"),
  ]);
  // Logout while a plugin session is live: the session still owns the state.
  if (id === null && useSessionStore.getState().accessToken) return;
  const emptyAccount: Account = { id: "" as Account["id"], packs: [], packOrder: [] };
  useAccountStore.getState().setAccount(emptyAccount);
  useUiStore.getState().setLastActivePackId(null);
});
