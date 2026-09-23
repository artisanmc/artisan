import { expect, test, vi } from "vitest";
import {
  EDITOR_TOUR_GUEST_KEY,
  EDITOR_TOUR_TRANSFER_KEY,
  createEditorTourStorage,
} from "./editorTourStorage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("guest progress survives separate demo sessions and denied browser storage", () => {
  const local = memoryStorage();
  const session = memoryStorage();
  const guest = createEditorTourStorage(
    () => local,
    () => session,
  );
  guest.writeGuest({ step: 3, completed: false });
  const reloaded = createEditorTourStorage(
    () => local,
    () => memoryStorage(),
  );
  expect(reloaded.readGuest()).toEqual({ step: 3, completed: false });
  const blocked = createEditorTourStorage(
    () => {
      throw new Error("denied");
    },
    () => session,
  );
  expect(blocked.readGuest()).toBeNull();
  blocked.writeGuest({ step: 6, completed: true });
  expect(blocked.readGuest()).toEqual({ step: 6, completed: true });
  const readOnly = createEditorTourStorage(
    () => ({
      ...memoryStorage(),
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    }),
    () => session,
  );
  readOnly.writeGuest({ step: 1, completed: false });
  expect(readOnly.readGuest()).toEqual({ step: 1, completed: false });
});

test.each(["{broken", "null", '{"step":99,"completed":false}'])(
  "malformed saved guest data (%s) cannot trigger a fresh automatic presentation or invalid import",
  (value) => {
    const local = memoryStorage();
    const session = memoryStorage();
    local.setItem(EDITOR_TOUR_GUEST_KEY, value);
    session.setItem(EDITOR_TOUR_TRANSFER_KEY, '{"accountId":null,"progress":{"step":99}}');
    const storage = createEditorTourStorage(
      () => local,
      () => session,
    );
    expect(storage.readGuest()).toEqual({ step: 0, completed: false });
    storage.bindTransfer("alice", "/demo/projects/demo");
    expect(storage.readTransfer("alice")).toBeNull();
  },
);

test("only explicit anonymous demo authentication transfers to the first returning account", () => {
  const local = memoryStorage();
  const session = memoryStorage();
  const guest = createEditorTourStorage(
    () => local,
    () => session,
  );
  guest.writeGuest({ step: 4, completed: false });
  guest.bindTransfer("ordinary-login", "/account");
  expect(guest.readTransfer("ordinary-login")).toBeNull();
  guest.prepareTransfer("already-signed-in", "/demo/projects/demo");
  expect(guest.readTransfer("already-signed-in")).toBeNull();
  guest.prepareTransfer(null, "/demo/projects/demo");
  guest.bindTransfer("alice", "/demo/projects/demo");
  const afterRedirect = createEditorTourStorage(
    () => local,
    () => session,
  );
  afterRedirect.bindTransfer("bob", "/demo/projects/demo");
  expect(afterRedirect.readTransfer("bob")).toBeNull();
  expect(afterRedirect.readTransfer("alice")).toEqual({ step: 4, completed: false });
  afterRedirect.clearTransfer("bob");
  expect(afterRedirect.readTransfer("alice")).not.toBeNull();
  afterRedirect.clearTransfer("alice");
  expect(afterRedirect.readTransfer("alice")).toBeNull();
});
