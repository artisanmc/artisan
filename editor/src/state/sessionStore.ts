import { create } from "zustand";

interface SessionState {
  token: string | null;
  serverKeyId: string | null;
  setSession: (token: string, serverKeyId: string) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  token: null,
  serverKeyId: null,
  setSession: (token, serverKeyId) => set({ token, serverKeyId }),
  clearSession: () => set({ token: null, serverKeyId: null }),
}));
