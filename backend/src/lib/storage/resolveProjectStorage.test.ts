import { expect, test } from "bun:test";
import type { Project } from "../projectStorage";
import { createProjectStorageResolver, projectLocation } from "./resolveProjectStorage";
import type { ProjectStorage } from "./ProjectStorage";

const project: Project = { id: "internal", identityKind: "folder", externalId: "folder", serverKeyId: "server", storageKind: "server", hostedRootId: null, hostedMinecraftVersion:null,hostedCreationFingerprint:null,demoSessionId:null, networkId: "network", name: "Name", description: null, slug: "folder", deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
const storage = {} as ProjectStorage;

test("resolver authorizes before selecting a location, including hosted roots", async () => {
  let constructed = false;
  const resolve = createProjectStorageResolver({
    findProject: async () => ({ ...project, storageKind: "hosted", serverKeyId: null, hostedRootId: "private-root" }),
    authorize: async () => { throw Object.assign(new Error("other network"), { code: "forbidden" }); },
    factories: { server: () => { constructed = true; return storage; }, hosted: () => { constructed = true; return storage; } },
  });
  await expect(resolve("intruder", "internal")).rejects.toMatchObject({ code: "forbidden" });
  expect(constructed).toBe(false);
});

test("both locations use the same authorized factory contract and immutable internal identity", async () => {
  for (const metadata of [project, { ...project, storageKind: "hosted" as const, serverKeyId: null, hostedRootId: "private-root" }]) {
    const events: unknown[] = [];
    const resolve = createProjectStorageResolver({
      findProject: async (id) => { events.push(id); return metadata; },
      authorize: async (user, row, capability) => { events.push([user, row.networkId, capability]); },
      factories: { server: (location) => { events.push(location); return storage; }, hosted: (location) => { events.push(location); return storage; } },
    });
    expect(await resolve("owner", "internal", "edit_content")).toBe(storage);
    expect(events).toEqual(["internal", ["owner", "network", "edit_content"], projectLocation(metadata)]);
  }
});

test("deleted projects do not reach authorization or construct storage", async () => {
  const resolve = createProjectStorageResolver({ findProject: async () => ({ ...project, deletedAt: new Date() }), authorize: async () => { throw new Error("must not reach"); }, factories: { server: () => storage, hosted: () => storage } });
  await expect(resolve("owner", "internal")).rejects.toMatchObject({ code: "not_found" });
});

test("malformed metadata never silently falls back to server storage", () => {
  expect(() => projectLocation({ ...project, serverKeyId: null })).toThrow("invalid_location");
  expect(() => projectLocation({ ...project, storageKind: "hosted", hostedRootId: "root" })).toThrow("invalid_location");
  expect(() => projectLocation({ ...project, storageKind: "hosted", serverKeyId: null, hostedRootId: "../private" })).toThrow("invalid_location");
  expect(() => projectLocation({ ...project, storageKind: "hosted", serverKeyId: null, hostedRootId: "root", externalId: "../folder" })).toThrow("invalid_location");
});
