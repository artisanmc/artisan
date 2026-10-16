import type { EditorTourAction, EditorTourProgress } from "@/lib/api/auth";
export type { EditorTourProgress } from "@/lib/api/auth";

export interface EditorTourIdentity {
  playerId: string | null;
  ready: boolean;
}

export interface EditorTourSnapshot {
  status: "idle" | "loading" | "ready" | "error";
  open: boolean;
  step: number;
  progress: EditorTourProgress | null;
  busy: boolean;
  error: string | null;
}

export interface EditorTourDependencies {
  readGuest(): EditorTourProgress | null;
  writeGuest(progress: EditorTourProgress): void;
  readTransfer?(playerId: string): EditorTourProgress | null;
  clearTransfer?(playerId: string): void;
  readPlayer(
    playerId: string,
  ): Promise<{ id: string; editorTour?: EditorTourProgress | null } | null>;
  writePlayer(
    playerId: string,
    action: EditorTourAction,
  ): Promise<
    | {
        user: { id: string; editorTour?: EditorTourProgress | null };
        tourStarted?: boolean;
      }
    | { error: string }
  >;
}

export function createEditorTourController(deps: EditorTourDependencies) {
  let current: EditorTourIdentity | null = null;
  let generation = 0;
  let snapshot: EditorTourSnapshot = {
    status: "idle",
    open: false,
    step: 0,
    progress: null,
    busy: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<EditorTourSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const save = async (step: number, complete = false) => {
    if (!current || !snapshot.progress || snapshot.busy) return;
    const started = generation;
    update({ busy: true, error: null });
    try {
      let progress = { step, completed: complete || snapshot.progress.completed };
      if (current.playerId) {
        const result = await deps.writePlayer(
          current.playerId,
          complete ? { action: "complete" } : { action: "progress", step },
        );
        if (started !== generation) return;
        if ("error" in result || result.user.id !== current.playerId || !result.user.editorTour)
          throw new Error("tour_unavailable");
        progress = result.user.editorTour;
      } else {
        deps.writeGuest(progress);
      }
      update({
        status: "ready",
        busy: false,
        step,
        progress,
        ...(complete ? { open: false } : {}),
      });
    } catch {
      if (started === generation)
        update({ status: "error", busy: false, error: "tour_unavailable" });
    }
  };
  const load = async (automatic: boolean) => {
    const identity = current;
    if (!identity) return;
    const started = ++generation;
    update({ status: "loading", busy: true, error: null, open: false });
    try {
      if (identity.playerId) {
        const user = await deps.readPlayer(identity.playerId);
        if (started !== generation) return;
        if (!user || user.id !== identity.playerId || user.editorTour === undefined)
          throw new Error("tour_unavailable");
        let progress = user.editorTour;
        let claimed = false;
        const transfer = deps.readTransfer?.(identity.playerId);
        if (transfer) {
          if (!progress) {
            const result = await deps.writePlayer(identity.playerId, {
              action: "import",
              ...transfer,
            });
            if (started !== generation) return;
            if (
              "error" in result ||
              result.user.id !== identity.playerId ||
              !result.user.editorTour
            )
              throw new Error("tour_unavailable");
            progress = result.user.editorTour;
          }
          deps.clearTransfer?.(identity.playerId);
        }
        if (!progress) {
          const result = await deps.writePlayer(identity.playerId, { action: "start" });
          if (started !== generation) return;
          if ("error" in result || result.user.id !== identity.playerId || !result.user.editorTour)
            throw new Error("tour_unavailable");
          progress = result.user.editorTour;
          claimed = result.tourStarted === true;
        }
        update({
          status: "ready",
          busy: false,
          open: automatic ? claimed : true,
          step: progress.step,
          progress,
        });
        return;
      }
      const saved = deps.readGuest();
      const progress = saved ?? { step: 0, completed: false };
      if (!saved) deps.writeGuest(progress);
      update({
        status: "ready",
        busy: false,
        open: automatic ? !saved : true,
        step: progress.step,
        progress,
      });
    } catch {
      if (started === generation)
        update({ status: "error", busy: false, error: "tour_unavailable" });
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async activate(identity: EditorTourIdentity) {
      if (!identity.ready || !identity.playerId) {
        ++generation;
        current = null;
        update({ status: "idle", open: false, progress: null, step: 0, busy: false, error: null });
        return;
      }
      if (current?.playerId !== identity.playerId) update({ progress: null, step: 0 });
      current = identity;
      await load(true);
    },
    deactivate() {
      ++generation;
      current = null;
      update({ status: "idle", open: false, progress: null, step: 0, busy: false, error: null });
    },
    next: () => save(Math.min(6, snapshot.step + 1)),
    back: () => save(Math.max(0, snapshot.step - 1)),
    complete: () => save(6, true),
    defer() {
      update({ open: false });
    },
    async resume() {
      if (!current || snapshot.busy) return;
      if (snapshot.status === "error") await load(false);
      else update({ open: true });
    },
    async replay() {
      if (!current || snapshot.busy) return;
      if (snapshot.status === "error") await load(false);
      if (snapshot.status === "ready") update({ open: true, step: 0 });
    },
  };
}
