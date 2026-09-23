import { render, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  editorTourController,
  mountEditorTour,
  prepareEditorTourAuthentication,
  useEditorTourState,
} from "./editorTourRuntime";

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  listeners: new Set<(state: { currentUser: { id: string } | null }) => void>(),
}));

vi.mock("@/state/authStore", () => ({
  useAuthStore: {
    getState: () => ({
      currentUser: auth.user,
      sessionStatus: auth.user ? "signed-in" : "signed-out",
    }),
    subscribe: (listener: (state: { currentUser: { id: string } | null }) => void) => {
      auth.listeners.add(listener);
      return () => auth.listeners.delete(listener);
    },
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  auth.user = null;
  for (const listener of auth.listeners) listener({ currentUser: null });
  editorTourController.deactivate();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

test("StrictMode presents the first guest welcome and unmount closes it without automatic replay", async () => {
  localStorage.clear();
  function Workspace() {
    const tour = useEditorTourState();
    useEffect(() => mountEditorTour({ accountId: null, demo: true, ready: true }), []);
    return <div>{tour.open ? "welcome" : "closed"}</div>;
  }
  const first = render(
    <StrictMode>
      <Workspace />
    </StrictMode>,
  );
  await waitFor(() => expect(first.getByText("welcome")).toBeInTheDocument());
  first.unmount();
  expect(editorTourController.getSnapshot().open).toBe(false);
  const second = render(
    <StrictMode>
      <Workspace />
    </StrictMode>,
  );
  await waitFor(() => expect(editorTourController.getSnapshot().status).toBe("ready"));
  expect(second.getByText("closed")).toBeInTheDocument();
});

test.each(["/signup?next=%2Fdemo%2Fprojects%2Fdemo", "/demo/projects/demo"])(
  "the explicit demo auth return at %s imports before claiming first presentation",
  async (returnLocation) => {
    await editorTourController.activate({ accountId: null, demo: true, ready: true });
    await editorTourController.next();
    prepareEditorTourAuthentication();
    window.history.replaceState(null, "", returnLocation);
    auth.user = { id: "alice" };
    for (const listener of auth.listeners) listener({ currentUser: auth.user });
    const fetcher = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(
          JSON.stringify({
            user: {
              id: "alice",
              editorTour: init?.method === "PATCH" ? { step: 1, completed: false } : null,
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await editorTourController.activate({ accountId: "alice", demo: true, ready: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body as string)).toEqual({
      editor_tour: { action: "import", step: 1, completed: false },
    });
    expect(editorTourController.getSnapshot()).toMatchObject({ open: false, step: 1 });
  },
);

test("an abandoned demo signup cannot transfer to an unrelated login or a later account", async () => {
  await editorTourController.activate({ accountId: null, demo: true, ready: true });
  await editorTourController.next();
  prepareEditorTourAuthentication();
  window.history.replaceState(null, "", "/login?next=%2Fpricing");
  const fetcher = vi.fn(
    async (_url: string, init: RequestInit) =>
      new Response(
        JSON.stringify({
          user: {
            id: auth.user?.id,
            editorTour: init?.method === "PATCH" ? { step: 0, completed: false } : null,
          },
          tourStarted: true,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  for (const id of ["ordinary-login", "later-demo-account"]) {
    auth.user = { id };
    for (const listener of auth.listeners) listener({ currentUser: auth.user });
    await editorTourController.activate({ accountId: id, demo: false, ready: true });
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body as string)).toEqual({
      editor_tour: { action: "start" },
    });
    window.history.replaceState(null, "", "/demo/projects/demo");
  }
});
