import i18n from "@/i18n";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAuthStore } from "./authStore";

const API = "http://x";

beforeEach(() => {
  useAuthStore.setState({
    currentUser: null,
    isLoading: false,
    sessionStatus: "unknown",
    error: null,
  });
  vi.restoreAllMocks();
});

describe("authStore.hydrate", () => {
  test("loads the current user when /me succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await useAuthStore.getState().hydrate(API);
    expect(useAuthStore.getState().currentUser?.id).toBe("u1");
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  test("leaves currentUser null when /me returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    await useAuthStore.getState().hydrate(API);
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  /**
   * An unreachable hub is NOT a sign-out: a `/me` answering 502 (or not
   * answering) says nothing about the session. Answering "anonymous" sent the
   * user to /login while the sidebar stayed there — the app contradicted
   * itself. As long as we do not know, stay loading and retry.
   */
  test("a /me returning 502 does not sign out: retries then loads the user", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const done = useAuthStore.getState().hydrate(API);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Still loading: no route may bounce to /login.
    expect(useAuthStore.getState().isLoading).toBe(true);
    expect(useAuthStore.getState().currentUser).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(useAuthStore.getState().currentUser?.id).toBe("u1");
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-in");
    vi.useRealTimers();
  });

  test("keeps the user in place if /me becomes unreachable mid-session", async () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      currentUser: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    void useAuthStore.getState().hydrate(API);
    await vi.advanceTimersByTimeAsync(60_000);
    // The known user stays known, and the app stays usable: only those we never
    // knew anything about are blocked.
    expect(useAuthStore.getState().currentUser?.id).toBe("u1");
    expect(useAuthStore.getState().isLoading).toBe(false);
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
  });

  /**
   * Anonymous mode no longer exists (accounts-only): either we know who you
   * are, or you go to /login. An unreachable hub therefore allows NO
   * conclusion — least of all "signed out", since /login would be just as
   * unusable. Stay "unknown" and retry, indefinitely.
   */
  test("never concludes a sign-out while the backend is unreachable", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 502 }));
    void useAuthStore.getState().hydrate(API);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useAuthStore.getState().sessionStatus).toBe("unknown");
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(2);
    // Make the hub reachable so the retry loop stops.
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-out");
    vi.useRealTimers();
  });

  /**
   * A 200 with an unreadable body (a proxy's HTML error page, a truncated
   * response) is not an answer either. Letting it surface as an exception let
   * `hydrate` die silently: `isLoading` stayed true forever, hence a blank app
   * with no explanation.
   */
  test("a /me with an unreadable body is treated as unreachable, not as a fatal failure", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("<html>502 Bad Gateway</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    void useAuthStore.getState().hydrate(API);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-in");
    expect(useAuthStore.getState().isLoading).toBe(false);
    vi.useRealTimers();
  });

  /**
   * Hidden tab: nobody is looking, and the hub may be restarting. Hammering a
   * struggling server every 10 s from N open tabs helps no one — wait for the
   * tab to come back, which is anyway when the answer matters.
   */
  test("suspends retries while the tab is hidden, and resumes when it returns", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 502 }));
    void useAuthStore.getState().hydrate(API);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-in");
    vi.useRealTimers();
  });

  test("a 401 does say 'not signed in', and does not retry", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));
    await useAuthStore.getState().hydrate(API);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-out");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("authStore.logout", () => {
  test("clears currentUser", async () => {
    useAuthStore.setState({ currentUser: { id: "u", email: "x@y.z", name: "X", avatarUrl: null } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await useAuthStore.getState().logout(API);
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});

describe("authStore — account-scoped state reset on identity switch", () => {
  test("switching to a different user clears accountStore + lastActiveProjectId", async () => {
    const { useAccountStore } = await import("./accountStore");
    const { useUiStore } = await import("./uiStore");
    // Sign in as user A and give the account some local state.
    useAuthStore.setState({
      currentUser: { id: "uA", email: "a@e.com", name: "A", avatarUrl: null },
    });
    await Promise.resolve(); // let the subscriber observe user A
    useAccountStore.getState().createProject({ id: "pack_a" });
    useUiStore.getState().setLastActiveProjectId("pack_a" as never);
    // Switch to user B in the same tab.
    useAuthStore.setState({
      currentUser: { id: "uB", email: "b@e.com", name: "B", avatarUrl: null },
    });
    await vi.waitFor(() => {
      expect(useAccountStore.getState().account.projects).toHaveLength(0);
      expect(useUiStore.getState().lastActiveProjectId).toBeNull();
    });
  });

  test("first sign-in (null → user) keeps prior state", async () => {
    const { useAccountStore } = await import("./accountStore");
    useAuthStore.setState({ currentUser: null });
    await Promise.resolve();
    useAccountStore.getState().createProject({ id: "pack_pre_login" });
    useAuthStore.setState({
      currentUser: { id: "uC", email: "c@e.com", name: "C", avatarUrl: null },
    });
    // Give the (async) subscriber a chance to run, then assert nothing was cleared.
    await new Promise((r) => setTimeout(r, 10));
    expect(useAccountStore.getState().account.projects.map((p) => p.id)).toContain(
      "pack_pre_login",
    );
  });
});

describe("authStore.hydrate — editor_language sync", () => {
  test("hydrate syncs editor_language to i18n.changeLanguage when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: "u1", email: "a@e.com", name: "A", avatarUrl: null, editorLanguage: "fr" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const changeLang = vi.spyOn(i18n, "changeLanguage").mockResolvedValue(undefined as never);

    await useAuthStore.getState().hydrate(API);

    expect(useAuthStore.getState().currentUser?.editorLanguage).toBe("fr");
    expect(changeLang).toHaveBeenCalledWith("fr");
  });

  test("hydrate does NOT call changeLanguage if editorLanguage is null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: "u1", email: "a@e.com", name: "A", avatarUrl: null, editorLanguage: null },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const changeLang = vi.spyOn(i18n, "changeLanguage").mockResolvedValue(undefined as never);

    await useAuthStore.getState().hydrate(API);

    expect(changeLang).not.toHaveBeenCalled();
  });
});

describe("authStore.hydrate — theme sync", () => {
  test("hydrate applies user.theme when no localStorage choice exists", async () => {
    localStorage.removeItem("artisan.theme");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "u1",
            email: "a@b.com",
            name: "A",
            avatarUrl: null,
            editorLanguage: null,
            theme: "light",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await useAuthStore.getState().hydrate(API);

    // themeStore.setTheme should have set data-theme on the document element
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("hydrate does NOT override theme when localStorage choice exists", async () => {
    localStorage.setItem("artisan.theme", JSON.stringify({ state: { theme: "dark" }, version: 0 }));
    document.documentElement.dataset.theme = "dark";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "u1",
            email: "a@b.com",
            name: "A",
            avatarUrl: null,
            editorLanguage: null,
            theme: "light",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await useAuthStore.getState().hydrate(API);

    // localStorage had "dark" — the server's "light" must NOT override it
    expect(document.documentElement.dataset.theme).toBe("dark");

    localStorage.removeItem("artisan.theme");
  });
});
