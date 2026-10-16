import { expect, test, vi } from "vitest";
import { type EditorTourDependencies, createEditorTourController } from "./editorTourController";

type WriteResult = Awaited<ReturnType<EditorTourDependencies["writePlayer"]>>;

test("switching player clears old progress immediately and ignores its late successful write", async () => {
  let finishWrite!: (value: WriteResult) => void;
  let finishRead!: (value: {
    id: string;
    editorTour: { step: number; completed: boolean };
  }) => void;
  const tour = createEditorTourController({
    readGuest: () => null,
    writeGuest: vi.fn(),
    readPlayer: (id) =>
      id === "alice"
        ? Promise.resolve({ id, editorTour: { step: 2, completed: false } })
        : new Promise((resolve) => {
            finishRead = resolve;
          }),
    writePlayer: vi.fn(
      () =>
        new Promise<WriteResult>((resolve) => {
          finishWrite = resolve;
        }),
    ),
  });
  await tour.activate({ playerId: "alice", ready: true });
  await tour.resume();
  const saving = tour.next();
  tour.deactivate();
  expect(tour.getSnapshot()).toMatchObject({
    status: "idle",
    progress: null,
    step: 0,
    open: false,
    busy: false,
  });
  const loading = tour.activate({ playerId: "bob", ready: true });
  finishWrite({ user: { id: "alice", editorTour: { step: 3, completed: false } } });
  await saving;
  expect(tour.getSnapshot()).toMatchObject({ progress: null, status: "loading" });
  finishRead({ id: "bob", editorTour: { step: 6, completed: true } });
  await loading;
  expect(tour.getSnapshot()).toMatchObject({ open: false, progress: { completed: true } });
});

test("transferred progress imports before automatic start and a failed import remains retryable", async () => {
  const guest = { step: 4, completed: false };
  const clearTransfer = vi.fn();
  const writePlayer = vi
    .fn()
    .mockResolvedValueOnce({ error: "offline" })
    .mockResolvedValue({ user: { id: "alice", editorTour: guest } });
  const tour = createEditorTourController({
    readGuest: () => guest,
    writeGuest: vi.fn(),
    readPlayer: async () => ({ id: "alice", editorTour: null }),
    writePlayer,
    readTransfer: (id: string) => (id === "alice" ? guest : null),
    clearTransfer,
  });
  await tour.activate({ playerId: "alice", ready: true });
  expect(tour.getSnapshot()).toMatchObject({ status: "error", open: false });
  expect(clearTransfer).not.toHaveBeenCalled();
  await tour.activate({ playerId: "alice", ready: true });
  expect(tour.getSnapshot()).toMatchObject({ open: false, step: 4, progress: guest });
  expect(writePlayer).toHaveBeenCalledTimes(2);
  expect(writePlayer).toHaveBeenLastCalledWith("alice", { action: "import", ...guest });
  expect(clearTransfer).toHaveBeenCalledWith("alice");
});

test("failed progress writes remain retryable and a deferred in-flight write cannot reopen", async () => {
  const writePlayer = vi.fn().mockRejectedValueOnce(new Error("offline"));
  const tour = createEditorTourController({
    readGuest: () => null,
    writeGuest: vi.fn(),
    readPlayer: async () => ({ id: "alice", editorTour: { step: 2, completed: false } }),
    writePlayer,
  });
  await tour.activate({ playerId: "alice", ready: true });
  await tour.resume();
  await tour.next();
  expect(tour.getSnapshot()).toMatchObject({ status: "error", busy: false, open: true, step: 2 });
  let finish!: (value: unknown) => void;
  writePlayer.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = tour.next();
  expect(tour.getSnapshot().busy).toBe(true);
  tour.defer();
  finish({ user: { id: "alice", editorTour: { step: 3, completed: false } } });
  await saving;
  expect(tour.getSnapshot()).toMatchObject({ status: "ready", busy: false, open: false, step: 3 });
});

test("an unready workspace or an anonymous visitor cannot present or record the tour", async () => {
  const readGuest = vi.fn(() => null);
  const writeGuest = vi.fn();
  const readPlayer = vi.fn();
  const tour = createEditorTourController({
    readGuest,
    writeGuest,
    readPlayer,
    writePlayer: vi.fn(),
  });
  await tour.activate({ playerId: "alice", ready: false });
  await tour.resume();
  expect(tour.getSnapshot().open).toBe(false);
  await tour.activate({ playerId: null, ready: true });
  await tour.replay();
  expect(tour.getSnapshot()).toMatchObject({ open: false, status: "idle" });
  expect(readPlayer).not.toHaveBeenCalled();
  expect(readGuest).not.toHaveBeenCalled();
  expect(writeGuest).not.toHaveBeenCalled();
});

test.each(["offline", "missing", "wrong-player", "signed-out"])(
  "an unavailable player preference (%s) never counts as unseen and can be retried manually",
  async (failure) => {
    const readPlayer = vi.fn(async () => {
      if (failure === "offline") throw new Error("offline");
      if (failure === "signed-out") return null;
      return { id: failure === "wrong-player" ? "bob" : "alice" };
    });
    const writePlayer = vi.fn();
    const tour = createEditorTourController({
      readGuest: () => null,
      writeGuest: vi.fn(),
      readPlayer,
      writePlayer,
    });
    await tour.activate({ playerId: "alice", ready: true });
    expect(tour.getSnapshot()).toMatchObject({ open: false, status: "error" });
    expect(writePlayer).not.toHaveBeenCalled();
    readPlayer.mockResolvedValue({
      id: "alice",
      editorTour: { step: 3, completed: false },
    } as never);
    await tour.resume();
    expect(tour.getSnapshot()).toMatchObject({ open: true, status: "ready", step: 3 });
  },
);

test("a late player read cannot open or write into another player", async () => {
  let finishAlice!: (value: { id: string; editorTour: null }) => void;
  const writePlayer = vi.fn();
  const tour = createEditorTourController({
    readGuest: () => null,
    writeGuest: vi.fn(),
    readPlayer: (id) =>
      id === "alice"
        ? new Promise((resolve) => {
            finishAlice = resolve;
          })
        : Promise.resolve({ id: "bob", editorTour: { step: 6, completed: true } }),
    writePlayer,
  });
  const alice = tour.activate({ playerId: "alice", ready: true });
  await tour.activate({ playerId: "bob", ready: true });
  finishAlice({ id: "alice", editorTour: null });
  await alice;
  expect(writePlayer).not.toHaveBeenCalled();
  expect(tour.getSnapshot()).toMatchObject({ open: false, progress: { completed: true } });
});

test("player progress survives defer, back and replay without resetting completed state", async () => {
  let saved = { step: 2, completed: false };
  const writeGuest = vi.fn();
  const deps = {
    readGuest: () => null,
    writeGuest,
    readPlayer: async () => ({ id: "alice", editorTour: saved }),
    writePlayer: vi.fn(async (_id: string, action: { action: string; step?: number }) => {
      saved =
        action.action === "complete"
          ? { step: 6, completed: true }
          : { step: action.step ?? 0, completed: saved.completed };
      return { user: { id: "alice", editorTour: saved } };
    }),
  };
  const tour = createEditorTourController(deps);
  await tour.activate({ playerId: "alice", ready: true });
  expect(tour.getSnapshot().open).toBe(false);
  await tour.resume();
  await tour.next();
  expect(tour.getSnapshot()).toMatchObject({ open: true, step: 3 });
  await tour.back();
  tour.defer();
  expect(saved).toEqual({ step: 2, completed: false });
  await tour.resume();
  await tour.complete();
  expect(tour.getSnapshot()).toMatchObject({ open: false, progress: { completed: true } });
  await tour.replay();
  expect(tour.getSnapshot()).toMatchObject({ open: true, step: 0, progress: { completed: true } });
  await tour.next();
  expect(saved.completed).toBe(true);
  expect(writeGuest).not.toHaveBeenCalled();
});

test("a signed-in visitor uses player truth and only opens after winning its automatic claim", async () => {
  const readGuest = vi.fn(() => ({ step: 4, completed: true }));
  const readPlayer = vi.fn().mockResolvedValue({ id: "alice", editorTour: null });
  const writePlayer = vi.fn().mockResolvedValue({
    user: { id: "alice", editorTour: { step: 0, completed: false } },
    tourStarted: true,
  });
  const tour = createEditorTourController({
    readGuest,
    writeGuest: vi.fn(),
    readPlayer,
    writePlayer,
  });
  await tour.activate({ playerId: "alice", ready: true });
  expect(readGuest).not.toHaveBeenCalled();
  expect(writePlayer).toHaveBeenCalledWith("alice", { action: "start" });
  expect(tour.getSnapshot()).toMatchObject({ open: true, progress: { step: 0, completed: false } });
  tour.deactivate();
  writePlayer.mockResolvedValue({
    user: { id: "alice", editorTour: { step: 0, completed: false } },
    tourStarted: false,
  });
  await tour.activate({ playerId: "alice", ready: true });
  expect(tour.getSnapshot().open).toBe(false);
});
