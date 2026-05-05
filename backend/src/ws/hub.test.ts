import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { handlePluginMessage } from "./hub";
import type { HelloMessage, HelloAckMessage } from "../protocol";

describe("handlePluginMessage", () => {
  test("hello with unknown key returns null", async () => {
    const hello: HelloMessage = {
      type: "hello",
      server_key: "sk_doesnotexist",
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(JSON.stringify(hello));
    expect(result).toBeNull();
  });

  test("hello with valid key returns hello_ack", async () => {
    // First create a key via the API
    const createRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "hub-test" }),
    });
    const { key } = (await createRes.json()) as { key: string };

    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(JSON.stringify(hello));
    expect(result).not.toBeNull();
    const ack = JSON.parse(result!) as HelloAckMessage;
    expect(ack.type).toBe("hello_ack");
    expect(ack.session_id).toBeDefined();
    expect(ack.tier).toBe("free");
  });
});
