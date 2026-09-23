import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db/index";
import { users } from "../db/schema";

const createdUserIds: string[] = [];

async function createAccount() {
  const email = `tour_${crypto.randomUUID()}@example.com`;
  const response = await app.fetch(new Request("http://x/api/v1/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "longenoughpw", name: "Tour" }),
  }));
  expect(response.status).toBe(201);
  const body = await response.json();
  createdUserIds.push(body.user.id);
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
  return { email, cookie, user: body.user };
}

async function readAccount(cookie: string) {
  const response = await app.fetch(new Request("http://x/api/v1/auth/me", {
    headers: { Cookie: cookie },
  }));
  expect(response.status).toBe(200);
  return (await response.json()).user;
}

async function patchAccount(cookie: string, body: unknown) {
  return app.fetch(new Request("http://x/api/v1/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }));
}

afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("account editor tour", () => {
  test("new accounts expose an unseen tour through signup and account reads", async () => {
    const { cookie, user } = await createAccount();
    expect(user.editorTour).toBeNull();
    expect((await readAccount(cookie)).editorTour).toBeNull();
    const response = await patchAccount(cookie, {});
    expect(response.status).toBe(200);
    expect((await response.json()).user.editorTour).toBeNull();
  });

  test("the first presentation is claimed once across concurrent tabs", async () => {
    const { cookie } = await createAccount();
    const responses = await Promise.all(Array.from({ length: 6 }, () =>
      patchAccount(cookie, { editor_tour: { action: "start" } }),
    ));
    const bodies = await Promise.all(responses.map(async (response) => {
      expect(response.status).toBe(200);
      return response.json();
    }));
    expect(bodies.filter((body) => body.tourStarted === true)).toHaveLength(1);
    expect(bodies.filter((body) => body.tourStarted === false)).toHaveLength(5);
    expect((await readAccount(cookie)).editorTour).toEqual({ step: 0, completed: false });
  });

  test("progress survives a new session and preserves language and theme preferences", async () => {
    const { cookie, email } = await createAccount();
    await patchAccount(cookie, { editor_tour: { action: "start" } });
    const response = await patchAccount(cookie, {
      editor_tour: { action: "progress", step: 3 }, editor_language: "fr", theme: "light",
    });
    expect(response.status).toBe(200);
    const { user } = await response.json();
    expect(user.editorTour).toEqual({ step: 3, completed: false });
    expect(user.editorLanguage).toBe("fr");
    expect(user.theme).toBe("light");

    const login = await app.fetch(new Request("http://x/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    expect(login.status).toBe(200);
    expect((await login.json()).user.editorTour).toEqual({ step: 3, completed: false });
    const secondCookie = login.headers.get("Set-Cookie")!.split(";")[0];
    expect((await readAccount(secondCookie)).editorTour).toEqual({ step: 3, completed: false });
    const repeatedStart = await patchAccount(secondCookie, { editor_tour: { action: "start" } });
    expect((await repeatedStart.json()).tourStarted).toBe(false);
    const previous = await patchAccount(secondCookie, { editor_tour: { action: "progress", step: 2 } });
    expect((await previous.json()).user.editorTour).toEqual({ step: 2, completed: false });
  });

  test("completion cannot be undone by stale progress, including concurrent requests", async () => {
    const { cookie } = await createAccount();
    await patchAccount(cookie, { editor_tour: { action: "start" } });
    const responses = await Promise.all([
      patchAccount(cookie, { editor_tour: { action: "progress", step: 1 } }),
      patchAccount(cookie, { editor_tour: { action: "complete" } }),
      patchAccount(cookie, { editor_tour: { action: "progress", step: 4 } }),
    ]);
    for (const response of responses) expect(response.status).toBe(200);
    expect((await readAccount(cookie)).editorTour).toEqual({ step: 6, completed: true });
    const stale = await patchAccount(cookie, { editor_tour: { action: "progress", step: 0 } });
    expect((await stale.json()).user.editorTour).toEqual({ step: 6, completed: true });
    const restart = await patchAccount(cookie, { editor_tour: { action: "start" } });
    const body = await restart.json();
    expect(body.tourStarted).toBe(false);
    expect(body.user.editorTour).toEqual({ step: 6, completed: true });
  });

  test("guest import fills an unseen account without replacing account progress or completion", async () => {
    const { cookie } = await createAccount();
    const imported = await patchAccount(cookie, { editor_tour: { action: "import", step: 4, completed: false } });
    expect(imported.status).toBe(200);
    expect((await imported.json()).user.editorTour).toEqual({ step: 4, completed: false });
    const replaced = await patchAccount(cookie, { editor_tour: { action: "import", step: 1, completed: false } });
    expect((await replaced.json()).user.editorTour).toEqual({ step: 4, completed: false });
    await patchAccount(cookie, { editor_tour: { action: "complete" } });
    const downgraded = await patchAccount(cookie, { editor_tour: { action: "import", step: 2, completed: false } });
    expect((await downgraded.json()).user.editorTour).toEqual({ step: 6, completed: true });

    const second = await createAccount();
    const completed = await patchAccount(second.cookie, { editor_tour: { action: "import", step: 6, completed: true } });
    expect((await completed.json()).user.editorTour).toEqual({ step: 6, completed: true });
    const repeat = await patchAccount(second.cookie, { editor_tour: { action: "start" } });
    expect((await repeat.json()).tourStarted).toBe(false);
  });

  test("invalid preference bodies are rejected without modifying tour or theme", async () => {
    const { cookie } = await createAccount();
    for (const invalid of [null, [], "start", 0, true]) {
      const response = await patchAccount(cookie, invalid);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_body");
    }
    const malformed = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{",
    }));
    expect(malformed.status).toBe(400);

    const invalidTours = [
      null, [], "start", {}, { action: "restart" },
      ...[-1, 7, 2.5, "2", null].map((step) => ({ action: "progress", step })),
      { action: "progress" }, { action: "import", step: 2 },
      { action: "import", step: 2, completed: "false" },
      { action: "import", step: 7, completed: false },
    ];
    for (const editor_tour of invalidTours) {
      const response = await patchAccount(cookie, { editor_tour, theme: "dark" });
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("invalid_editor_tour");
    }
    const user = await readAccount(cookie);
    expect(user.editorTour).toBeNull();
    expect(user.theme).toBeNull();
  });

  test("tour updates belong only to the authenticated account and require its session", async () => {
    const first = await createAccount();
    const second = await createAccount();
    const response = await patchAccount(first.cookie, {
      user_id: second.user.id,
      editor_tour: { action: "progress", step: 2, userId: second.user.id },
    });
    expect(response.status).toBe(200);
    expect((await readAccount(first.cookie)).editorTour).toEqual({ step: 2, completed: false });
    expect((await readAccount(second.cookie)).editorTour).toBeNull();

    for (const cookie of ["", "artisan_demo_session=guest", "artisan_user_session=invalid"]) {
      const unauthorized = await patchAccount(cookie, { editor_tour: { action: "complete" } });
      expect(unauthorized.status).toBe(401);
    }
    expect((await readAccount(first.cookie)).editorTour).toEqual({ step: 2, completed: false });
    expect((await readAccount(second.cookie)).editorTour).toBeNull();
  });

  test("guest imports cannot overwrite a concurrent completion or an earlier import", async () => {
    const { cookie } = await createAccount();
    const responses = await Promise.all([
      patchAccount(cookie, { editor_tour: { action: "import", step: 2, completed: false } }),
      patchAccount(cookie, { editor_tour: { action: "complete" } }),
      patchAccount(cookie, { editor_tour: { action: "import", step: 1, completed: false } }),
    ]);
    for (const response of responses) expect(response.status).toBe(200);
    expect((await readAccount(cookie)).editorTour).toEqual({ step: 6, completed: true });

    const other = await createAccount();
    const imports = await Promise.all([1, 5].map((step) =>
      patchAccount(other.cookie, { editor_tour: { action: "import", step, completed: false } }),
    ));
    const states = await Promise.all(imports.map(async (response) => (await response.json()).user.editorTour));
    expect(states[0]).toEqual(states[1]);
    expect((await readAccount(other.cookie)).editorTour).toEqual(states[0]);
  });
});
