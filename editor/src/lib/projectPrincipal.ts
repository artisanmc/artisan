import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";

export interface ProjectPrincipal {
  kind: "account" | "guest";
  id: string;
}
export interface ProjectPrincipalProvider {
  current(projectId?: string): ProjectPrincipal | null;
}
export function watchProjectPrincipal(projectId: string) {
  const initial = projectPrincipal.current(projectId);
  let changed = false;
  const inspect = () => {
    const current = projectPrincipal.current(projectId);
    if (current?.id !== initial?.id || current?.kind !== initial?.kind) changed = true;
  };
  const stopAccount = useAuthStore.subscribe(inspect);
  const stopDemo = useDemoStore.subscribe(inspect);
  return {
    assertCurrent() {
      inspect();
      if (!initial || changed) throw new Error("session_changed");
    },
    dispose() {
      stopAccount();
      stopDemo();
    },
  };
}
export const projectPrincipal: ProjectPrincipalProvider = {
  current(projectId) {
    const demo = useDemoStore.getState();
    if (demo.session && (projectId === demo.session.projectId || (!projectId && demo.active)))
      return demo.expired ? null : demo.session.principal;
    const user = useAuthStore.getState().currentUser;
    return user ? { kind: "account", id: user.id } : null;
  },
};
export function useProjectPrincipalId(projectId?: string) {
  const accountId = useAuthStore((state) => state.currentUser?.id);
  const session = useDemoStore((state) => state.session);
  const active = useDemoStore((state) => state.active);
  const expired = useDemoStore((state) => state.expired);
  return session && (projectId === session.projectId || (!projectId && active))
    ? expired
      ? undefined
      : session.principal.id
    : accountId;
}
