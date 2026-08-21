import i18n from "@/i18n";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAuthStore } from "./authStore";

const API = "http://x";

beforeEach(() => {
  useAuthStore.setState({
    currentUser: null,
    isLoading: false,
    sessionStatus: "unknown",
    backendUnreachable: false,
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
   * Un backend injoignable n'est PAS une déconnexion : `/me` qui répond 502 (ou
   * ne répond pas) ne dit rien de la session. Répondre « anonyme » renvoyait
   * l'utilisateur sur /login pendant que la sidebar restait là — l'app se
   * contredisait elle-même. Tant qu'on ne sait pas, on reste en chargement et
   * on réessaye.
   */
  test("un /me en 502 ne déconnecte pas : réessaye puis charge l'utilisateur", async () => {
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
    // Encore en chargement : aucune route ne doit rebondir vers /login.
    expect(useAuthStore.getState().isLoading).toBe(true);
    expect(useAuthStore.getState().currentUser).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(useAuthStore.getState().currentUser?.id).toBe("u1");
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-in");
    expect(useAuthStore.getState().backendUnreachable).toBe(false);
    vi.useRealTimers();
  });

  test("garde l'utilisateur en place si /me devient injoignable en cours de session", async () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      currentUser: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    void useAuthStore.getState().hydrate(API);
    await vi.advanceTimersByTimeAsync(60_000);
    // L'utilisateur connu reste connu, et l'app reste utilisable : on ne bloque
    // que ceux dont on n'a jamais rien su.
    expect(useAuthStore.getState().currentUser?.id).toBe("u1");
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().backendUnreachable).toBe(true);
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
   * Le mode anonyme n'existe plus (accounts-only) : soit on sait qui tu es,
   * soit tu vas sur /login. Un backend injoignable n'autorise donc AUCUNE
   * conclusion — surtout pas « déconnecté », puisque /login serait tout aussi
   * inutilisable. On reste en « inconnu » et on réessaye, indéfiniment.
   */
  test("ne conclut jamais à une déconnexion tant que le backend est injoignable", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 502 }));
    void useAuthStore.getState().hydrate(API);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useAuthStore.getState().sessionStatus).toBe("unknown");
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().backendUnreachable).toBe(true);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(2);
    // On rend le backend joignable pour que la boucle de réessai s'arrête.
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-out");
    vi.useRealTimers();
  });

  /**
   * Un 200 au corps illisible (page d'erreur HTML d'un proxy, réponse tronquée)
   * n'est pas une réponse non plus. Le laisser remonter en exception laissait
   * `hydrate` mourir en silence : `isLoading` restait vrai pour toujours, donc
   * app blanche sans la moindre explication.
   */
  test("un /me au corps illisible est traité comme injoignable, pas comme une panne fatale", async () => {
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

  test("un 401 dit « non connecté », lui, et ne réessaye pas", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));
    await useAuthStore.getState().hydrate(API);
    expect(useAuthStore.getState().sessionStatus).toBe("signed-out");
    expect(useAuthStore.getState().backendUnreachable).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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

    // localStorage had "dark" — backend "light" must NOT override it
    expect(document.documentElement.dataset.theme).toBe("dark");

    localStorage.removeItem("artisan.theme");
  });
});
