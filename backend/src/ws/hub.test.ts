import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { handlePluginMessage, registerConn } from "./hub";
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
    const result = await handlePluginMessage("test-conn", JSON.stringify(hello));
    expect(result.reply).toBeNull();
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
    const result = await handlePluginMessage("test-conn", JSON.stringify(hello));
    expect(result.reply).not.toBeNull();
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.type).toBe("hello_ack");
    expect(ack.session_id).toBeDefined();
    expect(ack.tier).toBe("free");
    expect(ack.api_url).toBeDefined();
  });
});

describe("setup_request", () => {
  test("returns setup_code with 8-char code and url", async () => {
    const connId = "conn-setup-req";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "setup_request" }));
    expect(result.reply).not.toBeNull();
    const msg = JSON.parse(result.reply!) as { type: string; code: string; url: string; expires_at: string };
    expect(msg.type).toBe("setup_code");
    expect(msg.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(msg.url).toContain(msg.code);
    expect(new Date(msg.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("setup_claim", () => {
  test("valid code returns link_confirmed and pushes it to the registered conn", async () => {
    // Create a code via REST
    const createRes = await app.request("/api/link", { method: "POST" });
    const { code } = (await createRes.json()) as { code: string };

    const received: string[] = [];
    const connId = "conn-setup-claim";
    registerConn(connId, (msg) => received.push(msg));

    await handlePluginMessage(connId, JSON.stringify({ type: "setup_claim", code }));
    expect(received.length).toBe(1);
    const msg = JSON.parse(received[0]) as { type: string; server_key: string };
    expect(msg.type).toBe("link_confirmed");
    expect(msg.server_key).toMatch(/^sk_[0-9a-f]{64}$/);
  });

  test("expired or unknown code returns null reply", async () => {
    const connId = "conn-setup-claim-bad";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "setup_claim", code: "BADCODE1" }));
    expect(result.reply).toBeNull();
  });
});
