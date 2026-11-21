import {
  Link,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetServerIds,
  isUnresolvedServerId,
  redirectToFullServerId,
  rememberServerIds,
  resolveServerId,
  shortServerId,
  shortServerIdRewrite,
  toInternalPath,
  toPublicPath,
} from "./shortServerIds";

const A = "22206191-e62a-4f32-9a48-a6509c95077b";
const B = "9f1c0d2e-1111-4222-8333-444455556666";
// Shares A's first 8 characters (and its dash): told apart at the 10th.
const C = "22206191-f000-4000-8000-000000000000";

afterEach(() => forgetServerIds());

describe("shortServerId", () => {
  it("keeps the first eight characters when no other server shares them", () => {
    expect(shortServerId(A, [A, B])).toBe("22206191");
  });

  it("lengthens the prefix until it is unique, never ending on a dash", () => {
    expect(shortServerId(A, [A, B, C])).toBe("22206191-e");
    expect(shortServerId(C, [A, B, C])).toBe("22206191-f");
  });

  it("leaves an id the hub never listed whole", () => {
    expect(shortServerId(A, [B])).toBe(A);
  });
});

describe("resolveServerId", () => {
  it("finds the full id behind a unique prefix", () => {
    expect(resolveServerId("22206191", [A, B])).toBe(A);
    expect(resolveServerId("22206191-f", [A, B, C])).toBe(C);
  });

  it("keeps a full id, an ambiguous prefix and an unknown one as they are", () => {
    expect(resolveServerId(A, [A, B])).toBe(A);
    expect(resolveServerId("22206191", [A, C])).toBe("22206191");
    expect(resolveServerId("deadbeef", [A, B])).toBe("deadbeef");
  });

  it("never resolves a prefix shorter than eight characters", () => {
    expect(resolveServerId("2220", [A])).toBe("2220");
  });

  it("round-trips every id", () => {
    const ids = [A, B, C];
    for (const id of ids) expect(resolveServerId(shortServerId(id, ids), ids)).toBe(id);
  });
});

describe("isUnresolvedServerId", () => {
  it("is true only for a short-id-looking segment the list does not resolve", () => {
    expect(isUnresolvedServerId("22206191", [])).toBe(true);
    expect(isUnresolvedServerId("22206191", [A])).toBe(false);
    expect(isUnresolvedServerId(A, [])).toBe(false);
    expect(isUnresolvedServerId("srv-1", [])).toBe(false);
  });
});

describe("paths", () => {
  it("rewrites only the server segment", () => {
    const ids = [A, B];
    const full = `/servers/${A}/projects/daily/screen/daily:rewards`;
    expect(toPublicPath(full, ids)).toBe("/servers/22206191/projects/daily/screen/daily:rewards");
    expect(toInternalPath("/servers/22206191/projects/daily", ids)).toBe(
      `/servers/${A}/projects/daily`,
    );
    expect(toInternalPath("/servers/22206191", ids)).toBe(`/servers/${A}`);
    expect(toPublicPath("/servers", ids)).toBe("/servers");
    expect(toPublicPath(`/m/${A}`, ids)).toBe(`/m/${A}`);
  });
});

describe("redirectToFullServerId", () => {
  const location = { pathname: "/servers/22206191/play", searchStr: "?tab=1", hash: "" };

  it("reads the list, then redirects to the full id", async () => {
    const load = vi.fn(async () => rememberServerIds([A, B]));
    const thrown = await redirectToFullServerId("22206191", location, load).catch((e) => e);
    expect(load).toHaveBeenCalledOnce();
    expect(thrown?.options?.href).toBe(`/servers/${A}/play?tab=1`);
    expect(thrown?.options?.replace).toBe(true);
  });

  it("does nothing for a full id, an unknown server or a failed list", async () => {
    const load = vi.fn(async () => rememberServerIds([B]));
    await expect(redirectToFullServerId(A, location, load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    await expect(redirectToFullServerId("22206191", location, load)).resolves.toBeUndefined();
    const fail = vi.fn(async () => {
      throw new Error("401");
    });
    await expect(redirectToFullServerId("22206191", location, fail)).resolves.toBeUndefined();
  });
});

/** The editor's router options on a small tree: the routes see the full id, the URL shows the short one. */
function mount(initial: string, loadServers: () => Promise<unknown>) {
  const root = createRootRoute();
  const server = createRoute({
    getParentRoute: () => root,
    path: "/servers/$serverId",
    beforeLoad: ({ params, location }) =>
      redirectToFullServerId(params.serverId, location, loadServers),
  });
  const screenRoute = createRoute({
    getParentRoute: () => server,
    path: "/projects/$projectId/screen/$screenId",
    component: function Screen() {
      const { serverId, screenId } = screenRoute.useParams();
      return (
        <div>
          <span data-testid="server">{serverId}</span>
          <span data-testid="screen">{screenId}</span>
          <Link
            to="/servers/$serverId/projects/$projectId/screen/$screenId"
            params={{ serverId: B, projectId: "daily", screenId: "daily:streak" }}
          >
            other
          </Link>
        </div>
      );
    },
  });
  const history = createMemoryHistory({ initialEntries: [initial] });
  const router = createRouter({
    routeTree: root.addChildren([server.addChildren([screenRoute])]),
    history,
    rewrite: shortServerIdRewrite,
    pathParamsAllowedCharacters: [":"],
  });
  render(<RouterProvider router={router} />);
  return { router, history };
}

describe("router", () => {
  it("opens a short URL under the full id, before the list was known", async () => {
    const { history } = mount("/servers/22206191/projects/daily/screen/daily:rewards", async () =>
      rememberServerIds([A, B]),
    );
    expect(await screen.findByTestId("server")).toHaveTextContent(A);
    expect(screen.getByTestId("screen")).toHaveTextContent("daily:rewards");
    expect(history.location.pathname).toBe("/servers/22206191/projects/daily/screen/daily:rewards");
  });

  it("still opens an old URL with the full id and an encoded colon", async () => {
    rememberServerIds([A, B]);
    mount(`/servers/${A}/projects/daily/screen/daily%3Arewards`, async () => undefined);
    expect(await screen.findByTestId("server")).toHaveTextContent(A);
    expect(screen.getByTestId("screen")).toHaveTextContent("daily:rewards");
  });

  it("writes links with the short id and a plain colon", async () => {
    rememberServerIds([A, B]);
    mount("/servers/22206191/projects/daily/screen/daily:rewards", async () => undefined);
    const link = await screen.findByText("other");
    expect(link.getAttribute("href")).toBe("/servers/9f1c0d2e/projects/daily/screen/daily:streak");
    await act(async () => link.click());
    expect(await screen.findByTestId("server")).toHaveTextContent(B);
  });
});
