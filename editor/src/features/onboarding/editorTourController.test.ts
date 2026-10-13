import { expect, test, vi } from "vitest";
import { createEditorTourController } from "./editorTourController";

test("switching account clears old progress immediately and ignores its late successful write", async () => {
  let finishWrite!: (value: unknown) => void;
  let finishRead!: (value: {
    id: string;
    editorTour: { step: number; completed: boolean };
  }) => void;
  const tour = createEditorTourController({
    readGuest: () => null,
    writeGuest: vi.fn(),
    readAccount: (id) =>
      id === "alice"
        ? Promise.resolve({ id, editorTour: { step: 2, completed: false } })
        : new Promise((resolve) => {
            finishRead = resolve;
          }),
    writeAccount: vi.fn(
      () =>
        new Promise((resolve) => {
          finishWrite = resolve;
        }),
    ),
  });
  await tour.activate({ accountId: "alice", ready: true });
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
  const loading = tour.activate({ accountId: "bob", ready: true });
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
  const writeAccount = vi
    .fn()
    .mockResolvedValueOnce({ error: "offline" })
    .mockResolvedValue({ user: { id: "alice", editorTour: guest } });
  const tour = createEditorTourController({
    readGuest: () => guest,
    writeGuest: vi.fn(),
    readAccount: async () => ({ id: "alice", editorTour: null }),
    writeAccount,
    readTransfer: (id: string) => (id === "alice" ? guest : null),
    clearTransfer,
  });
  await tour.activate({ accountId: "alice", ready: true });
  expect(tour.getSnapshot()).toMatchObject({ status: "error", open: false });
  expect(clearTransfer).not.toHaveBeenCalled();
  await tour.activate({ accountId: "alice", ready: true });
  expect(tour.getSnapshot()).toMatchObject({ open: false, step: 4, progress: guest });
  expect(writeAccount).toHaveBeenCalledTimes(2);
  expect(writeAccount).toHaveBeenLastCalledWith("alice", { action: "import", ...guest });
  expect(clearTransfer).toHaveBeenCalledWith("alice");
});

test("failed progress writes remain retryable and a deferred in-flight write cannot reopen", async () => {
  const writeAccount = vi.fn().mockRejectedValueOnce(new Error("offline"));
  const tour = createEditorTourController({
    readGuest: () => null,
    writeGuest: vi.fn(),
    readAccount: async () => ({ id: "alice", editorTour: { step: 2, completed: false } }),
    writeAccount,
  });
  await tour.activate({ accountId: "alice", ready: true });
  await tour.resume();
  await tour.next();
  expect(tour.getSnapshot()).toMatchObject({ status: "error", busy: false, open: true, step: 2 });
  let finish!: (value: unknown) => void;
  writeAccount.mockImplementation(
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
  const readAccount = vi.fn();
  const tour = createEditorTourController({
    readGuest,
    writeGuest,
    readAccount,
    writeAccount: vi.fn(),
  });
  await tour.activate({ accountId: "alice", ready: false });
  await tour.resume();
  expect(tour.getSnapshot().open).toBe(false);
  await tour.activate({ accountId: null, ready: true });
  await tour.replay();
  expect(tour.getSnapshot()).toMatchObject({ open: false, status: "idle" });
  expect(readAccount).not.toHaveBeenCalled();
  expect(readGuest).not.toHaveBeenCalled();
  expect(writeGuest).not.toHaveBeenCalled();
});

test.each(["offline", "missing", "wrong-account", "signed-out"])(
  "an unavailable account preference (%s) never counts as unseen and can be retried manually",
  async (failure) => {
    const readAccount = vi.fn(async () => {
      if (failure === "offline") throw new Error("offline");
      if (failure === "signed-out") return null;
      return { id: failure === "wrong-account" ? "bob" : "alice" };
    });
    const writeAccount = vi.fn();
    const tour = createEditorTourController({
      readGuest: () => null,
      writeGuest: vi.fn(),
      readAccount,
      writeAccount,
    });
    await tour.activate({ accountId: "alice", ready: true });
    expect(tour.getSnapshot()).toMatchObject({ open: false, status: "error" });
    expect(writeAccount).not.toHaveBeenCalled();
    readAccount.mockResolvedValue({
      id: "alice",
      editorTour: { step: 3, completed: false },
    } as never);
    await tour.resume();
    expect(tour.getSnapshot()).toMatchObject({ open: true, status: "ready", step: 3 });
  },
);

test("a late account read cannot open or write into another account", async () => {
  let finishAlice!: (value: { id: string; editorTour: null }) => void;
  const writeAccount = vi.fn();
  const tour = createEditorTourController({
    readGuest: () => null,
    writeGuest: vi.fn(),
    readAccount: (id) =>
      id === "alice"
        ? new Promise((resolve) => {
            finishAlice = resolve;
          })
        : Promise.resolve({ id: "bob", editorTour: { step: 6, completed: true } }),
    writeAccount,
  });
  const alice = tour.activate({ accountId: "alice", ready: true });
  await tour.activate({ accountId: "bob", ready: true });
  finishAlice({ id: "alice", editorTour: null });
  await alice;
  expect(writeAccount).not.toHaveBeenCalled();
  expect(tour.getSnapshot()).toMatchObject({ open: false, progress: { completed: true } });
});

test("account progress survives defer, back and replay without resetting completed state", async () => {
  let saved = { step: 2, completed: false };
  const writeGuest = vi.fn();
  const deps = {
    readGuest: () => null,
    writeGuest,
    readAccount: async () => ({ id: "alice", editorTour: saved }),
    writeAccount: vi.fn(async (_id: string, action: { action: string; step?: number }) => {
      saved =
        action.action === "complete"
          ? { step: 6, completed: true }
          : { step: action.step ?? 0, completed: saved.completed };
      return { user: { id: "alice", editorTour: saved } };
    }),
  };
  const tour = createEditorTourController(deps);
  await tour.activate({ accountId: "alice", ready: true });
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

test("a signed-in visitor uses account truth and only opens after winning its automatic claim", async () => {
  const readGuest = vi.fn(() => ({ step: 4, completed: true }));
  const readAccount = vi.fn().mockResolvedValue({ id: "alice", editorTour: null });
  const writeAccount = vi.fn().mockResolvedValue({
    user: { id: "alice", editorTour: { step: 0, completed: false } },
    tourStarted: true,
  });
  const tour = createEditorTourController({
    readGuest,
    writeGuest: vi.fn(),
    readAccount,
    writeAccount,
  });
  await tour.activate({ accountId: "alice", ready: true });
  expect(readGuest).not.toHaveBeenCalled();
  expect(writeAccount).toHaveBeenCalledWith("alice", { action: "start" });
  expect(tour.getSnapshot()).toMatchObject({ open: true, progress: { step: 0, completed: false } });
  tour.deactivate();
  writeAccount.mockResolvedValue({
    user: { id: "alice", editorTour: { step: 0, completed: false } },
    tourStarted: false,
  });
  await tour.activate({ accountId: "alice", ready: true });
  expect(tour.getSnapshot().open).toBe(false);
});
