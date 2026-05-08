import { create } from "zustand";

interface SessionState {
  accessToken: string | null;
  serverKeyId: string | null;
  trustCode: string | null;
  trusted: boolean;
  setSession: (accessToken: string, serverKeyId: string, trustCode: string, trusted: boolean) => void;
  setAccessToken: (accessToken: string) => void;
  setTrusted: (trusted: boolean) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  accessToken: null,
  serverKeyId: null,
  trustCode: null,
  trusted: false,
  setSession: (accessToken, serverKeyId, trustCode, trusted) =>
    set({ accessToken, serverKeyId, trustCode, trusted }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setTrusted: (trusted) => set({ trusted }),
  clearSession: () => set({ accessToken: null, serverKeyId: null, trustCode: null, trusted: false }),
}));
