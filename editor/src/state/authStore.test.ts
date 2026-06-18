import i18n from "@/i18n";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAuthStore } from "./authStore";

const API = "http://x";

beforeEach(() => {
  useAuthStore.setState({ currentUser: null, isLoading: false, error: null });
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
});

describe("authStore.login", () => {
  test("sets currentUser on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: "u2", email: "b@e.com", name: "Bob", avatarUrl: null } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await useAuthStore
      .getState()
      .login(API, { email: "b@e.com", password: "longenoughpw" });
    expect(result.ok).toBe(true);
    expect(useAuthStore.getState().currentUser?.id).toBe("u2");
    expect(useAuthStore.getState().error).toBeNull();
  });

  test("sets error on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await useAuthStore
      .getState()
      .login(API, { email: "x@y.z", password: "longenoughpw" });
    expect(result.ok).toBe(false);
    expect(useAuthStore.getState().error).toBe("invalid_credentials");
    expect(useAuthStore.getState().currentUser).toBeNull();
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

  test("first sign-in (null → user) keeps session-mode state", async () => {
    const { useAccountStore } = await import("./accountStore");
    useAuthStore.setState({ currentUser: null });
    await Promise.resolve();
    useAccountStore.getState().createProject({ id: "pack_session" });
    useAuthStore.setState({
      currentUser: { id: "uC", email: "c@e.com", name: "C", avatarUrl: null },
    });
    // Give the (async) subscriber a chance to run, then assert nothing was cleared.
    await new Promise((r) => setTimeout(r, 10));
    expect(useAccountStore.getState().account.projects.map((p) => p.id)).toContain("pack_session");
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

    // localStorage had "dark" — backend "light" must NOT override it
    expect(document.documentElement.dataset.theme).toBe("dark");

    localStorage.removeItem("artisan.theme");
  });
});
