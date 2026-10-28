import { useAuthStore } from "@/state/authStore";

export interface ProjectPrincipal {
  kind: "player";
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
    if (current?.id !== initial?.id) changed = true;
  };
  const stop = useAuthStore.subscribe(inspect);
  return {
    assertCurrent() {
      inspect();
      if (!initial || changed) throw new Error("session_changed");
    },
    dispose() {
      stop();
    },
  };
}
export const projectPrincipal: ProjectPrincipalProvider = {
  current() {
    const user = useAuthStore.getState().currentUser;
    return user ? { kind: "player", id: user.id } : null;
  },
};
export function useProjectPrincipalId(_projectId?: string) {
  return useAuthStore((state) => state.currentUser?.id);
}
