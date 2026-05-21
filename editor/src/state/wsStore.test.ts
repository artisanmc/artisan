import { describe, expect, it } from "vitest";

describe("useWsStore", () => {
  it("sets connected + serverId + apiUrl when hello_ack received", () => {
    const state = {
      connected: false,
      serverId: null as string | null,
      apiUrl: null as string | null,
      serverKey: null as string | null,
    };

    function handleMessage(raw: string, serverKey: string) {
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === "hello_ack") {
          state.connected = true;
          state.serverId  = msg.server_id as string;
          state.apiUrl    = msg.api_url   as string;
          state.serverKey = serverKey;
        }
      } catch { /* ignore */ }
    }

    handleMessage(
      JSON.stringify({ type: "hello_ack", server_id: "srv1", api_url: "http://localhost:3001", tier: "free", session_id: "s1", needs_sync: false, latest_bundle_hash: "", pack_hashes: {} }),
      "sk_test",
    );

    expect(state.connected).toBe(true);
    expect(state.serverId).toBe("srv1");
    expect(state.apiUrl).toBe("http://localhost:3001");
  });
});
