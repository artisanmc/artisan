import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useServerPapiPlaceholdersStore } from "./serverPapiPlaceholdersStore";

const scope = { userId: "u1", serverId: "s1" };
const placeholders = [{ placeholder: "%player_name%", expansion: "player" }];

describe("server PlaceholderAPI catalog", () => {
  beforeEach(() => {
    useServerPapiPlaceholdersStore.getState().clear();
    vi.unstubAllGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("loads declared placeholders for a server and clears them when it goes offline", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ placeholders })))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await useServerPapiPlaceholdersStore.getState().load(scope);
    expect(useServerPapiPlaceholdersStore.getState().placeholders).toEqual(placeholders);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/servers/s1/papi-placeholders"),
      expect.objectContaining({ credentials: "include" }),
    );
    await useServerPapiPlaceholdersStore.getState().load(scope);
    expect(useServerPapiPlaceholdersStore.getState().placeholders).toEqual([]);
  });

  it("ignores a delayed catalog after switching servers or signing out", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ placeholders: [] }))),
    );
    const old = useServerPapiPlaceholdersStore.getState().load(scope);
    await useServerPapiPlaceholdersStore.getState().load({ ...scope, serverId: "s2" });
    useServerPapiPlaceholdersStore.getState().clear();
    finish(new Response(JSON.stringify({ placeholders })));
    await old;
    expect(useServerPapiPlaceholdersStore.getState().key).toBeNull();
    expect(useServerPapiPlaceholdersStore.getState().placeholders).toEqual([]);
  });

  it("shares a pending request and refetches when the server reconnects", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ placeholders })));
    vi.stubGlobal("fetch", fetchMock);
    const first = useServerPapiPlaceholdersStore.getState().load(scope);
    const second = useServerPapiPlaceholdersStore.getState().load(scope);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response("{}", { status: 503 }));
    await Promise.all([first, second]);
    await useServerPapiPlaceholdersStore.getState().load(scope);
    expect(useServerPapiPlaceholdersStore.getState().placeholders).toEqual(placeholders);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
