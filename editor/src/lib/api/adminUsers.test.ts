import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdminUser, listAdminUsers, updateAdminUser } from "./adminUsers";

afterEach(() => vi.unstubAllGlobals());

const USER = {
  id: "u1",
  email: "a@b.c",
  name: "Ana",
  avatarUrl: null,
  editorLanguage: null,
  theme: null,
  isAdmin: false,
  hasPassword: true,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

describe("adminUsers client", () => {
  it("listAdminUsers fetches with credentials and the encoded query", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ users: [USER] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const users = await listAdminUsers("ana b");
    expect(users).toEqual([USER]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/admin/users?q=ana%20b");
    expect(init).toMatchObject({ credentials: "include" });
  });

  it("listAdminUsers returns null on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    expect(await listAdminUsers("")).toBeNull();
  });

  it("getAdminUser returns the profile with networks", async () => {
    const profile = { ...USER, networks: [{ id: "n1", name: "Net", slug: "net", role: "owner" }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(profile), { status: 200 })),
    );
    expect(await getAdminUser("u1")).toEqual(profile);
  });

  it("updateAdminUser PATCHes the edited fields", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ...USER, name: "Bea" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await updateAdminUser("u1", { name: "Bea", isAdmin: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe("Bea");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/admin/users/u1");
    expect(init).toMatchObject({ method: "PATCH", credentials: "include" });
    expect(JSON.parse(init.body as string)).toEqual({ name: "Bea", isAdmin: true });
  });

  it("updateAdminUser surfaces the error code on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "email_taken" }), { status: 409 })),
    );
    const r = await updateAdminUser("u1", { email: "a@b.c" });
    expect(r).toEqual({ ok: false, status: 409, error: "email_taken" });
  });
});
