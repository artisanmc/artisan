import { create } from "zustand";
import type { AuthUserDto } from "@/lib/api/auth";
import { getMe, login as apiLogin, logout as apiLogout, signup as apiSignup } from "@/lib/api/auth";

interface AuthState {
  currentUser: AuthUserDto | null;
  isLoading: boolean;
  error: string | null;
  hydrate: (apiUrl: string) => Promise<void>;
  login: (apiUrl: string, payload: { email: string; password: string })
    => Promise<{ ok: true } | { ok: false; error: string; status: number }>;
  signup: (apiUrl: string, payload: { email: string; password: string; name: string })
    => Promise<{ ok: true } | { ok: false; error: string; status: number }>;
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
