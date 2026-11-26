import { useKitStore } from "@/state/kitStore";
import { beforeEach, describe, expect, test } from "vitest";
import type { ServerProjectsResult } from "./serverIndexLoader";
import { useServerIndexStore } from "./serverIndexStore";

type Read = NonNullable<ServerProjectsResult["reads"]>[number];

const read = (folder: string, summary: Record<string, unknown> = {}): Read =>
  ({
    summary: { id: `srv.${folder}`, externalId: folder, name: folder, role: "theme", ...summary },
    files: {},
    binaries: [],
  }) as unknown as Read;

describe("the server index, as the kit store reads it", () => {
  beforeEach(() => {
    useServerIndexStore.getState().reset();
    useKitStore.setState({ read: undefined, own: {}, modules: [], modulesUnread: false });
  });

  test("the common images' theme and the themes of their own folder, movable when the server says so", () => {
    useServerIndexStore.getState().begin("srv");
    useServerIndexStore.getState().finish("srv", {
      status: "ready",
      projects: [],
      failed: [],
      reads: [
        read("artisan"),
        read("noel", { capabilities: { canRename: true } }),
        // A server that does not move a theme's folder says nothing, or says no.
        read("hiver"),
        read("nuit", { capabilities: { canRename: false } }),
        read("guilds", { role: undefined }),
      ],
    } as unknown as ServerProjectsResult);
    const { read: kit, own } = useKitStore.getState();
    expect(kit).toMatchObject({ projectId: "srv.artisan", byName: true });
    expect(Object.keys(own).sort()).toEqual(["hiver", "noel", "nuit"]);
    expect(own.noel).toMatchObject({ projectId: "srv.noel", canMove: true });
    expect(own.hiver?.canMove).toBe(false);
    expect(own.nuit?.canMove).toBe(false);
  });

  test("the modules in the pack's order, without the common images nor the themes", () => {
    const finish = (failed: string[]) => {
      useServerIndexStore.getState().begin("srv");
      useServerIndexStore.getState().finish("srv", {
        status: "ready",
        projects: [],
        failed,
        reads: [
          read("warps", { role: undefined }),
          read("artisan"),
          read("noel"),
          read("guilds", { role: undefined }),
        ],
      } as unknown as ServerProjectsResult);
    };
    finish([]);
    const { modules, modulesUnread } = useKitStore.getState();
    expect(modules.map((m) => [m.projectId, m.folder])).toEqual([
      ["srv.guilds", "guilds"],
      ["srv.warps", "warps"],
    ]);
    expect(modulesUnread).toBe(false);
    // A module that could not be read: the list is not all of them.
    finish(["shop"]);
    expect(useKitStore.getState().modulesUnread).toBe(true);
    useServerIndexStore.getState().reset();
    expect(useKitStore.getState().modules).toEqual([]);
  });
});
