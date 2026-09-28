import { expect, test } from "bun:test";
import type { Project } from "../projectStorage";
import { createProjectStorageResolver, projectLocation } from "./resolveProjectStorage";
import type { ProjectStorage } from "./ProjectStorage";

const project: Project = { id: "internal", identityKind: "folder", externalId: "folder", serverKeyId: "server", storageKind: "server", hostedMinecraftVersion: null, demoSessionId: null, networkId: "network", name: "Name", description: null, slug: "folder", unpublished: false, deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
const storage = {} as ProjectStorage;

test("resolver authorizes before selecting a location", async () => {
  let constructed = false;
  const resolve = createProjectStorageResolver({
    findProject: async () => project,
    authorize: async () => { throw Object.assign(new Error("other network"), { code: "forbidden" }); },
    factories: { server: () => { constructed = true; return storage; } },
  });
  await expect(resolve("intruder", "internal")).rejects.toMatchObject({ code: "forbidden" });
  expect(constructed).toBe(false);
});

test("server projects use the authorized factory with their immutable internal identity", async () => {
  const events: unknown[] = [];
  const resolve = createProjectStorageResolver({
    findProject: async (id) => { events.push(id); return project; },
    authorize: async (user, row, capability) => { events.push([user, row.networkId, capability]); },
    factories: { server: (location) => { events.push(location); return storage; } },
  });
  expect(await resolve("owner", "internal", "edit_content")).toBe(storage);
  expect(events).toEqual(["internal", ["owner", "network", "edit_content"], projectLocation(project)]);
});

test("an account never opens a demo project", async () => {
  const resolve = createProjectStorageResolver({
    findProject: async () => ({ ...project, storageKind: "demo", serverKeyId: null, networkId: null, demoSessionId: "demo_x" }),
    authorize: async () => {},
    factories: { server: () => storage },
  });
  await expect(resolve("owner", "internal")).rejects.toMatchObject({ code: "forbidden" });
});

test("deleted projects do not reach authorization or construct storage", async () => {
  const resolve = createProjectStorageResolver({ findProject: async () => ({ ...project, deletedAt: new Date() }), authorize: async () => { throw new Error("must not reach"); }, factories: { server: () => storage } });
  await expect(resolve("owner", "internal")).rejects.toMatchObject({ code: "not_found" });
});

test("malformed metadata never silently falls back to server storage", () => {
  expect(() => projectLocation({ ...project, serverKeyId: null })).toThrow("invalid_location");
  expect(() => projectLocation({ ...project, storageKind: "hosted" as never })).toThrow("invalid_location");
  expect(projectLocation({ ...project, storageKind: "demo", serverKeyId: null })).toEqual({ kind: "demo", folderName: "folder" });
});
