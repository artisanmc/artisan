import { afterEach, expect, test } from "bun:test";
import { db } from "../db";
import { networks, serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { supportsVanillaGui } from "../lib/resourcePack";
import { cleanupConn, handlePluginMessage, registerConn } from "./hub";

afterEach(() => cleanupConn("vanilla-gui"));

test("a server supports transparent containers only when its plugin says so in hello", async () => {
  await db.delete(networks);
  const now = new Date();
  await db.insert(networks).values({ id: "vanilla-gui", name: "N", createdAt: now, updatedAt: now });
  const key = await generateServerKey();
  await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: "vanilla-gui", createdAt: now });
  registerConn("vanilla-gui", () => {});
  const hello = (capabilities: string[]) =>
    handlePluginMessage("vanilla-gui", JSON.stringify({ type: "hello", server_key: key.key, plugin_version: "test", minecraft_version: "26.2", current_bundle_hash: "", local_project_ids: [], capabilities }));

  await hello([]);
  expect(supportsVanillaGui(key.id)).toBe(false);
  await hello(["vanilla_gui_v1"]);
  expect(supportsVanillaGui(key.id)).toBe(true);
  await hello(["project_drafts_v1"]);
  expect(supportsVanillaGui(key.id)).toBe(false);
});
