import { create } from "zustand";

export interface DemoSession {
  principal: { kind: "guest"; id: string };
  projectId: string;
  expiresAt: string;
  csrfToken: string;
}
export const useDemoStore = create<{
  session: DemoSession | null;
  active: boolean;
  expired: boolean;
  setSession: (session: DemoSession | null) => void;
  setActive: (active: boolean) => void;
  expire: () => void;
}>((set) => ({
  session: null,
  active: false,
  expired: false,
  setSession: (session) => set({ session, expired: false }),
  setActive: (active) => set({ active }),
  expire: () => set({ expired: true }),
}));
