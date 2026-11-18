import { describe, expect, it } from "vitest";
import { type PluginModule, type ProjectRow, moduleLabelFromId } from "./projectGroups";
import {
  type DeployedVersion,
  lastDeployOfServer,
  moduleLines,
  recentActivity,
} from "./serverOverview";

const row = (id: string, ownerModule: string | null = null): ProjectRow => ({
  id,
  name: id,
  hash: "",
  serverKeyId: "srv",
  ownerModule,
  ownerLabel: null,
});
const version = (createdAt: string, author: string | null = "Iban_"): DeployedVersion => ({
  createdAt,
  author: author ? { name: author } : null,
  changed: ["menus/main.yml"],
});
const quests: PluginModule = {
  id: "quests",
  label: "Quests",
  projects: [row("srv.quests", "quests"), row("srv.quests_extra", "quests")],
  entries: [],
};

describe("moduleLabelFromId", () => {
  it("reads an id the way declared names read", () => {
    expect(moduleLabelFromId("daily-rewards")).toBe("Daily rewards");
    expect(moduleLabelFromId("guilds")).toBe("Guilds");
    expect(moduleLabelFromId("my_module")).toBe("My module");
  });
});

describe("moduleLines", () => {
  it("lists the plugins' modules then the admin's folders, with the newest Version and the pending files", () => {
    const lines = moduleLines({
      pluginModules: [quests],
      contentModules: [row("srv.main")],
      versions: {
        "srv.quests": [version("2026-11-17T10:00:00Z")],
        "srv.quests_extra": [version("2026-11-18T09:00:00Z", "Kaelis")],
        "srv.main": [],
      },
      pending: { "srv.quests": 2, "srv.quests_extra": 1 },
    });
    expect(lines.map((l) => [l.label, l.kind, l.pending])).toEqual([
      ["Quests", "addon", 3],
      ["srv.main", "content", 0],
    ]);
    expect(lines[0]?.lastDeploy?.author?.name).toBe("Kaelis");
    // Read, never deployed: null, not "still reading".
    expect(lines[1]?.lastDeploy).toBeNull();
    expect(lastDeployOfServer(lines)?.createdAt).toBe("2026-11-18T09:00:00Z");
  });

  it("says nothing yet while a folder is read, and never deployed when it cannot be read", () => {
    const [reading] = moduleLines({
      pluginModules: [],
      contentModules: [row("srv.main")],
      versions: {},
      pending: {},
    });
    expect(reading?.lastDeploy).toBeUndefined();
    const [failed] = moduleLines({
      pluginModules: [],
      contentModules: [row("srv.main")],
      versions: { "srv.main": null },
      pending: {},
    });
    expect(failed?.lastDeploy).toBeNull();
  });
});

describe("recentActivity", () => {
  it("merges every module's Versions, newest first, up to the limit", () => {
    const versions = {
      "srv.quests": [version("2026-11-17T10:00:00Z"), version("2026-11-10T10:00:00Z")],
      "srv.quests_extra": [],
      "srv.main": [version("2026-11-18T08:00:00Z", null)],
    };
    const lines = moduleLines({
      pluginModules: [quests],
      contentModules: [row("srv.main")],
      versions,
      pending: {},
    });
    const activity = recentActivity(lines, versions, 2);
    expect(activity.map((a) => [a.label, a.version.createdAt])).toEqual([
      ["srv.main", "2026-11-18T08:00:00Z"],
      ["Quests", "2026-11-17T10:00:00Z"],
    ]);
  });
});
